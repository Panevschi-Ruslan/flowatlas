import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { interpolated, readComposeFile } from './compose.js';
import { readServerlessFile, readWorkerJson, readWorkerToml } from './deployed.js';
import { namesInEnvFile, readEnvFile } from './dotenv.js';
import { composeEnvironment, envFileEnvironment, envFileReading } from './files.js';
import { readProjectSettings } from './read.js';

describe('which environment files may be read for values (P77)', () => {
  it('reads an example, a sample, a template and a developer’s own file for values', () => {
    for (const name of ['.env.example', '.env.sample', '.env.template', '.env.dist', 'env.example', 'example.env', '.env-sample', '.env.development', '.env.dev', '.env.production.example']) {
      expect(envFileReading(name)).toBe('values');
    }
  });

  it('reads only the names in a file that holds what a deployment is really given', () => {
    for (const name of ['.env', '.env.local', '.env.development.local', '.env.production', '.env.staging', '.env.test']) {
      expect(envFileReading(name)).toBe('names');
    }
  });

  it('reads nothing of a file that is not an environment file', () => {
    for (const name of ['.envrc', '.environment', 'env.ts', 'package.json']) expect(envFileReading(name)).toBeUndefined();
  });

  it('says which environment a file is for, in one spelling', () => {
    expect(envFileEnvironment('.env.dev.example')).toBe('development');
    expect(envFileEnvironment('.env.example')).toBeUndefined();
    expect(envFileEnvironment('.env.staging')).toBe('staging');
    expect(composeEnvironment('docker-compose.prod.yml')).toBe('production');
    expect(composeEnvironment('compose.override.yaml')).toBeUndefined();
    expect(composeEnvironment('docker-compose.yml')).toBeUndefined();
  });
});

describe('reading an environment file', () => {
  it('reads values, quoted or not, and leaves comments and empty values out', () => {
    const text = ['# comment', 'export ORDERS_URL="http://orders:3000"', "PAYMENTS_URL='http://payments:4000'", 'EMPTY=', 'PORT=3000 # where it runs'].join('\n');
    expect(readEnvFile(text)).toEqual([
      { name: 'ORDERS_URL', raw: 'http://orders:3000' },
      { name: 'PAYMENTS_URL', raw: 'http://payments:4000' },
      { name: 'PORT', raw: '3000' },
    ]);
  });

  it('gives only the names of a file whose values are never read', () => {
    expect(namesInEnvFile('API_TOKEN=not-a-real-token\nORDERS_URL=\nINVENTORY_URL=http://inventory\n')).toEqual(['API_TOKEN', 'INVENTORY_URL']);
  });
});

describe('reading a compose file', () => {
  it('reads each container’s names, build directory, published ports and environment', () => {
    const [shop, payments] = readComposeFile(
      [
        'services:',
        '  shop:',
        '    build: ./storefront',
        '    environment:',
        '      - PAYMENTS_BASE=http://payments-api:4000',
        '      - LOG_LEVEL=debug',
        '      - CATALOG_URL=${CATALOG_URL:-http://catalog:3002}',
        '      - SHELL_ONLY=${FROM_SHELL}',
        '    env_file: .env.example',
        '  payments-api:',
        '    build:',
        '      context: ./payments',
        '    container_name: payments',
        '    ports: ["4000:4000", "127.0.0.1:9229:9229", "3000"]',
        '    environment:',
        '      ORDERS_URL: http://orders:3000',
      ].join('\n'),
    );
    expect(shop).toMatchObject({ name: 'shop', context: './storefront', envFiles: ['.env.example'] });
    expect(shop?.environment).toEqual([
      { name: 'PAYMENTS_BASE', raw: 'http://payments-api:4000' },
      { name: 'LOG_LEVEL', raw: 'debug' },
      { name: 'CATALOG_URL', raw: 'http://catalog:3002' },
    ]);
    expect(payments).toMatchObject({ name: 'payments-api', context: './payments', aliases: ['payments'], published: [4000, 9229] });
    expect(payments?.environment).toEqual([{ name: 'ORDERS_URL', raw: 'http://orders:3000' }]);
  });

  it('reads a placeholder as its default, and nothing where the shell decides', () => {
    expect(interpolated('http://${HOST:-orders}:3000')).toBe('http://orders:3000');
    expect(interpolated('http://${HOST-orders}:3000')).toBe('http://orders:3000');
    expect(interpolated('http://$HOST:3000')).toBeUndefined();
    expect(interpolated('cost $$5')).toBe('cost $5');
  });

  it('reads nothing of a file that is not one', () => {
    expect(readComposeFile('not: [valid')).toEqual([]);
    expect(readComposeFile('version: "3"')).toEqual([]);
  });
});

describe('reading what a deployment file declares', () => {
  it('reads a function framework’s variables, for every function and for one', () => {
    const read = readServerlessFile(
      [
        'provider:',
        '  environment:',
        '    ORDERS_API: http://orders:3000',
        '    STAGE_URL: https://${opt:stage}.example.com',
        'functions:',
        '  charge:',
        '    handler: src/charge.handler',
        '    environment:',
        '      LEDGER_URL: https://ledger.example.org/v1',
      ].join('\n'),
    );
    expect(read.declared).toEqual([
      { name: 'ORDERS_API', raw: 'http://orders:3000' },
      { name: 'LEDGER_URL', raw: 'https://ledger.example.org/v1', within: 'charge' },
    ]);
  });

  it('reads a worker’s variables, per environment, and the port it runs on locally', () => {
    const json = readWorkerJson(
      ['{', '  // comment', '  "name": "shop",', '  "vars": { "ORDERS_URL": "http://localhost:3001", },', '  "env": { "staging": { "vars": { "ORDERS_URL": "https://orders.staging.example.com" } } },', '  "dev": { "port": 8787 }', '}'].join('\n'),
    );
    expect(json.declared).toEqual([
      { name: 'ORDERS_URL', raw: 'http://localhost:3001' },
      { name: 'ORDERS_URL', raw: 'https://orders.staging.example.com', environment: 'staging' },
    ]);
    expect(json.ports).toEqual([8787]);
    expect(json.names).toEqual(['shop']);
    const toml = readWorkerToml(
      ['name = "shop"', '[vars]', 'ORDERS_URL = "http://localhost:3001"', '[env.staging]', 'vars = { ORDERS_URL = "https://orders.staging.example.com" }', '[[routes]]', 'pattern = "x"', '[dev]', 'port = 8787'].join('\n'),
    );
    expect(toml).toEqual(json);
  });
});

describe('what a project’s files say its settings are', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  const project = (files: Record<string, string>): string => {
    root = mkdtempSync(join(tmpdir(), 'flowatlas-settings-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };

  const FILES = {
    'docker-compose.yml': [
      'services:',
      '  shop:',
      '    build: ./storefront',
      '    environment:',
      '      PAYMENTS_BASE: http://payments-api:4000',
      '  payments-api:',
      '    build: ./payments',
      '    ports: ["4000:4000"]',
      '  db:',
      '    image: postgres',
      '    environment:',
      '      POSTGRES_PASSWORD: hunter2',
    ].join('\n'),
    'storefront/.env.example': 'ORDERS_API=http://orders:3000\nAPI_KEY=https://keys.example.com\nDATABASE_URL=postgres://app:app@db:5432/app\n',
    'storefront/.env.development': 'ORDERS_API=http://localhost:3001\n',
    'storefront/.env': 'INVENTORY_URL=http://user:secret@inventory.internal\nAPI_TOKEN=not-a-real-token\n',
    'orders/.env.example': 'PORT=3001\n',
    'payments/serverless.yml': 'provider:\n  environment:\n    ORDERS_API: http://orders:3000\n',
  };

  const services = (dir: string) => ['storefront', 'orders', 'payments'].map((name) => ({ name, dir: join(dir, name) }));

  it('hands each container’s environment and names to the service it is built from', () => {
    const dir = project(FILES);
    const read = readProjectSettings({ services: services(dir), rootDir: dir });
    expect(read['storefront']?.values).toEqual({
      ORDERS_API: [
        { value: 'http://localhost:3001', file: '.env.development', environment: 'development' },
        { value: 'http://orders:3000', file: '.env.example' },
      ],
      PAYMENTS_BASE: [{ value: 'http://payments-api:4000', file: 'docker-compose.yml', within: 'shop' }],
    });
    expect(read['storefront']?.namedOnly).toEqual({ API_TOKEN: ['.env'], INVENTORY_URL: ['.env'] });
    expect(read['payments']?.hosts.map((alias) => alias.host)).toEqual(['payments-api', 'localhost:4000', '127.0.0.1:4000', '0.0.0.0:4000']);
    expect(read['payments']?.values).toEqual({ ORDERS_API: [{ value: 'http://orders:3000', file: 'serverless.yml' }] });
    expect(read['orders']?.hosts.map((alias) => alias.host)).toEqual(['localhost:3001', '127.0.0.1:3001', '0.0.0.0:3001']);
  });

  it('never keeps a secret, a credential or a value that is not an address', () => {
    const dir = project(FILES);
    const text = JSON.stringify(readProjectSettings({ services: services(dir), rootDir: dir }));
    for (const secret of ['not-a-real-token', 'secret', 'hunter2', 'keys.example.com', 'postgres', 'app:app']) {
      expect(text.includes(secret)).toBe(false);
    }
  });

  it('reads the chosen environment’s files, and the files for no environment in particular', () => {
    const dir = project(FILES);
    const chosen = readProjectSettings({ services: services(dir), rootDir: dir, environment: 'dev' });
    expect(chosen['storefront']?.values['ORDERS_API']).toEqual([{ value: 'http://localhost:3001', file: '.env.development', environment: 'development' }]);
    const other = readProjectSettings({ services: services(dir), rootDir: dir, environment: 'staging' });
    expect(other['storefront']?.values['ORDERS_API']).toEqual([{ value: 'http://orders:3000', file: '.env.example' }]);
  });
});

describe('the workers a worker is bound to (P91)', () => {
  const bound = [
    { binding: 'CATALOG', service: 'catalog-worker' },
    { binding: 'STOCK', service: 'stock-worker', entrypoint: 'Lookup' },
    { binding: 'CATALOG', service: 'catalog-worker-staging', environment: 'staging' },
  ];

  it('reads them from JSON and from JSON with comments, per environment', () => {
    const json = readWorkerJson(
      JSON.stringify({
        name: 'orders-worker',
        services: [
          { binding: 'CATALOG', service: 'catalog-worker' },
          { binding: 'STOCK', service: 'stock-worker', entrypoint: 'Lookup' },
        ],
        env: { staging: { name: 'orders-worker-staging', services: [{ binding: 'CATALOG', service: 'catalog-worker-staging' }] } },
      }),
    );
    expect(json.bindings).toEqual(bound);
    expect(json.names).toEqual(['orders-worker', 'orders-worker-staging']);
    const jsonc = readWorkerJson(
      [
        '{',
        '  // reached by name rather than by address',
        '  "name": "orders-worker",',
        '  "services": [',
        '    { "binding": "CATALOG", "service": "catalog-worker" },',
        '    { "binding": "STOCK", "service": "stock-worker", "entrypoint": "Lookup" },',
        '  ],',
        '  "env": { "staging": { "name": "orders-worker-staging", "services": [{ "binding": "CATALOG", "service": "catalog-worker-staging" }] } },',
        '}',
      ].join('\n'),
    );
    expect(jsonc).toEqual(json);
  });

  it('reads them from TOML, as an inline array and as arrays of tables, per environment', () => {
    const inline = readWorkerToml(
      [
        'name = "orders-worker"',
        'services = [ { binding = "CATALOG", service = "catalog-worker" }, { binding = "STOCK", service = "stock-worker", entrypoint = "Lookup" } ]',
        '[env.staging]',
        'name = "orders-worker-staging"',
        'services = [ { binding = "CATALOG", service = "catalog-worker-staging" } ]',
      ].join('\n'),
    );
    expect(inline.bindings).toEqual(bound);
    expect(inline.names).toEqual(['orders-worker', 'orders-worker-staging']);
    const tables = readWorkerToml(
      [
        'name = "orders-worker"',
        '[[services]]',
        'binding = "CATALOG"',
        'service = "catalog-worker"',
        '[[services]]',
        'binding = "STOCK"',
        'service = "stock-worker"',
        'entrypoint = "Lookup"',
        '[[routes]]',
        'pattern = "shop.example.test/*"',
        '[env.staging]',
        'name = "orders-worker-staging"',
        '[[env.staging.services]]',
        'binding = "CATALOG"',
        'service = "catalog-worker-staging"',
      ].join('\n'),
    );
    expect(tables.bindings).toEqual(bound);
  });

  it('keeps a binding only when it is written out in full', () => {
    const read = readWorkerJson(JSON.stringify({ services: [{ binding: 'CATALOG' }, { binding: 'STOCK', service: '${STOCK_WORKER}' }] }));
    expect(read.bindings).toBeUndefined();
  });

  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('hands them to the service whose files declare them, for the chosen environment', () => {
    root = mkdtempSync(join(tmpdir(), 'flowatlas-bindings-'));
    mkdirSync(join(root, 'orders'), { recursive: true });
    writeFileSync(
      join(root, 'orders', 'wrangler.json'),
      JSON.stringify({
        name: 'orders-worker',
        services: [{ binding: 'CATALOG', service: 'catalog-worker' }],
        env: { staging: { services: [{ binding: 'CATALOG', service: 'catalog-worker-staging' }] } },
      }),
    );
    const services = [{ name: 'orders', dir: join(root, 'orders') }];
    const all = readProjectSettings({ services, rootDir: root });
    expect(all['orders']?.bindings?.map((each) => each.service)).toEqual(['catalog-worker', 'catalog-worker-staging']);
    expect(all['orders']?.deployedAs).toEqual(['orders-worker']);
    const staging = readProjectSettings({ services, rootDir: root, environment: 'staging' });
    expect(staging['orders']?.bindings).toEqual([
      { binding: 'CATALOG', service: 'catalog-worker-staging', file: 'wrangler.json', environment: 'staging' },
    ]);
  });
});
