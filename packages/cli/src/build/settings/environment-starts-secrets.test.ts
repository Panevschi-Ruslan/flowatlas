import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readComposeFile } from './compose.js';
import { readProjectSettings } from './read.js';

/** What P337 left open about a container's or a script's environment (P343). */

const lines = (...each: string[]): string => each.join('\n');

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
const project = (files: Record<string, string>): string => {
  root = mkdtempSync(join(tmpdir(), 'flowatlas-env-starts-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

describe("compose's environment written with no value (P343)", () => {
  it('takes the value compose interpolates with, as a list item or a key with none, and leaves one nothing gives unset', () => {
    const variables = { PORT: '4100', ADMIN_PORT: '4101' };
    const [shop] = readComposeFile(lines('services:', '  shop:', '    environment:', '      - PORT', '      - METRICS_PORT', '      - HOST=0.0.0.0'), variables);
    expect(shop?.environment).toEqual([
      { name: 'PORT', raw: '4100' },
      { name: 'HOST', raw: '0.0.0.0' },
    ]);
    const [admin] = readComposeFile(lines('services:', '  admin:', '    environment:', '      ADMIN_PORT:', '      METRICS_PORT:'), variables);
    expect(admin?.environment).toEqual([{ name: 'ADMIN_PORT', raw: '4101' }]);
    // A build argument with no value is the variable's too, as compose resolves it.
    const [built] = readComposeFile(lines('services:', '  built:', '    build:', '      context: .', '      args:', '        - PORT'), variables);
    expect(built?.image?.args).toEqual({ PORT: '4100' });
  });

  it("gives the container the port the project's .env, a command's --env-file or its shell gives, and none from a .env value never lent", () => {
    const dir = project({
      'docker-compose.yml': lines('services:', '  orders:', '    build: ./orders', '    environment:', '      - PORT', '      - API_TOKEN'),
      '.env': 'PORT=4300\nAPI_TOKEN=abc123\n',
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.containers?.[0]?.environment).toEqual({ PORT: 4300 });
    expect(JSON.stringify(read)).not.toContain('abc123');
  });
});

describe("an included compose file's variables, as compose resolves them (P343)", () => {
  it("keeps the including project's environment over the included file's own .env and env_file, which give only what it does not", () => {
    const dir = project({
      'docker-compose.yml': lines('include:', '  - deploy/catalog.compose.yaml', '  - path: deploy/search.compose.yaml', '    env_file: deploy/search.env', 'services:', '  shop:', '    build: ./shop'),
      '.env': 'CATALOG_PORT=8200\n',
      'deploy/catalog.compose.yaml': lines('services:', '  catalog:', '    build: ../catalog', '    ports:', '      - "${CATALOG_PORT:-8099}:4000"', '      - "${CATALOG_ADMIN_PORT:-8098}:4001"'),
      'deploy/.env': 'CATALOG_PORT=8103\nCATALOG_ADMIN_PORT=8113\n',
      'deploy/search.compose.yaml': lines('services:', '  search:', '    build: ../search', '    ports:', '      - "${SEARCH_PORT:-8099}:4000"'),
      'deploy/search.env': 'SEARCH_PORT=8104\n',
    });
    const services = ['shop', 'catalog', 'search'].map((name) => ({ name, dir: join(dir, name) }));
    const read = readProjectSettings({ services, rootDir: dir });
    expect(read['catalog']?.containers?.[0]?.ports.map((port) => port.published)).toEqual([8200, 8113]);
    expect(read['search']?.containers?.[0]?.ports.map((port) => port.published)).toEqual([8104]);
  });

  it("resolves an include's path, project_directory and env_file from the including project's directory", () => {
    const dir = project({
      // The included file's project directory is the including one's, so what it includes is found from there.
      'docker-compose.yml': lines('include:', '  - path: compose/stack.yaml', '    project_directory: .'),
      'compose/stack.yaml': lines('include:', '  - path: parts/web.yaml', '    env_file: parts/web.env'),
      'parts/web.yaml': lines('services:', '  web:', '    build: ../web', '    ports:', '      - "${WEB_PORT:-8099}:3000"'),
      'parts/web.env': 'WEB_PORT=8105\n',
      'compose/parts/web.yaml': lines('services:', '  web:', '    build: ../../web', '    ports:', '      - "8199:3000"'),
    });
    const read = readProjectSettings({ services: [{ name: 'web', dir: join(dir, 'web') }], rootDir: dir });
    expect(read['web']?.containers?.map((each) => [each.file, each.ports.map((port) => port.published)])).toEqual([['parts/web.yaml', [8105]]]);
  });
});

describe("a Makefile's exported variables, the environment of a server its recipe starts (P343)", () => {
  it('gives the service the port a file-wide or a target export gives, firmly', () => {
    const dir = project({
      Makefile: lines('export PORT := 4500', 'ledger-dev: export PORT = 4510', 'stock-dev:', '\tcd stock && npm start', 'ledger-dev:', '\tcd ledger && npm run dev'),
      'stock/package.json': JSON.stringify({ name: 'stock', scripts: { start: 'node src/main.js' } }),
      'ledger/package.json': JSON.stringify({ name: 'ledger', scripts: { dev: 'node src/main.js' } }),
    });
    const read = readProjectSettings({
      services: [
        { name: 'stock', dir: join(dir, 'stock') },
        { name: 'ledger', dir: join(dir, 'ledger') },
      ],
      rootDir: dir,
    });
    expect(read['stock']?.ports?.['PORT']).toEqual([{ port: 4500, file: 'Makefile', started: true }]);
    expect(read['ledger']?.ports?.['PORT']).toEqual([{ port: 4510, file: 'Makefile', started: true }]);
  });
});

describe("a script's export reaching a program of the project's own (P343)", () => {
  const listening = lines("import { createServer } from 'node:http';", 'createServer(() => {}).listen(Number(process.env.PORT ?? 3000));');
  const services = (dir: string) => ['api', 'jobs', 'web'].map((name) => ({ name, dir: join(dir, name) }));

  it("follows a package's bin, a path to a shell script and a package script to the file that listens, and the service that holds it", () => {
    const dir = project({
      'scripts/run-api.sh': lines('export PORT=4610', 'shop-api --verbose'),
      'scripts/run-jobs.sh': lines('export PORT=4620', './bin/jobs'),
      'scripts/run-web.sh': lines('cd web', 'export PORT=4630', 'npm run serve-site'),
      'api/package.json': JSON.stringify({ name: '@shop/api', bin: { 'shop-api': './cli.js' } }),
      'api/cli.js': lines('#!/usr/bin/env node', "require('./src/server');"),
      'api/src/server.js': listening,
      'bin/jobs': lines('#!/bin/sh', 'exec node jobs/src/main.mjs'),
      'jobs/src/main.mjs': lines("import './serve.mjs';"),
      'jobs/src/serve.mjs': listening,
      'web/package.json': JSON.stringify({ name: 'web', scripts: { 'serve-site': 'tsx src/site.ts' } }),
      'web/src/site.ts': listening,
    });
    const read = readProjectSettings({ services: services(dir), rootDir: dir });
    expect(read['api']?.ports?.['PORT']).toEqual([{ port: 4610, file: 'scripts/run-api.sh', started: true }]);
    expect(read['jobs']?.ports?.['PORT']).toEqual([{ port: 4620, file: 'scripts/run-jobs.sh', started: true }]);
    expect(read['web']?.ports?.['PORT']).toEqual([{ port: 4630, file: 'scripts/run-web.sh', started: true }]);
  });

  it('reads no start for a program whose code is not read listening, nor one no package gives', () => {
    const dir = project({
      'scripts/migrate.sh': lines('export PORT=4640', './bin/migrate', 'psql -c "select 1"'),
      'bin/migrate': lines('#!/usr/bin/env node', "console.log('migrated');"),
      'api/package.json': JSON.stringify({ name: 'api' }),
    });
    const read = readProjectSettings({ services: services(dir), rootDir: dir });
    expect(read['api']?.ports).toBeUndefined();
    expect(read['api']?.rows).toBeUndefined();
  });

  it("says a bin a build writes, started with a port, is not read, at the service whose package gives it", () => {
    const dir = project({
      'scripts/run-api.sh': lines('export PORT=4650', 'shop-api'),
      'api/package.json': JSON.stringify({ name: 'api', bin: { 'shop-api': 'dist/cli.js' } }),
    });
    const read = readProjectSettings({ services: services(dir), rootDir: dir });
    expect(read['api']?.ports).toBeUndefined();
    expect(read['api']?.rows).toEqual([
      expect.objectContaining({
        reason: 'server-start-unread',
        level: 'info',
        file: 'scripts/run-api.sh',
        line: 2,
        message: 'scripts/run-api.sh:2 starts shop-api with PORT=4650, but api/dist/cli.js is not in the repository (what a build writes is not read), so where api listens when started that way is not known',
      }),
    ]);
  });
});

describe("a port a Secret gives, by name and source only (P343)", () => {
  const workload = (env: readonly string[]): string =>
    lines(
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: ledger',
      'spec:',
      '  selector:',
      '    matchLabels:',
      '      app: ledger',
      '  template:',
      '    metadata:',
      '      labels:',
      '        app: ledger',
      '    spec:',
      '      containers:',
      '        - name: ledger',
      '          image: ledger',
      ...env,
      '---',
      'apiVersion: v1',
      'kind: Service',
      'metadata:',
      '  name: ledger',
      'spec:',
      '  selector:',
      '    app: ledger',
      '  ports:',
      '    - port: 80',
      '      targetPort: 7000',
    );

  it('names the Secret and the key each setting is from, and where the Secret is written, and no value of it enters what is read', () => {
    const dir = project({
      'k8s/ledger.yaml': workload([
        '          envFrom:',
        '            - secretRef:',
        '                name: ledger-secrets',
        '          env:',
        '            - name: PORT',
        '              valueFrom:',
        '                secretKeyRef:',
        '                  name: ledger-ports',
        '                  key: http',
        '            - name: METRICS_PORT',
        '              valueFrom:',
        '                secretKeyRef:',
        '                  name: made-elsewhere',
        '                  key: metrics',
      ]),
      // Base64 of 9477 and 9488; plain 9499 and a token.
      'k8s/ledger-secrets.yaml': lines('apiVersion: v1', 'kind: Secret', 'metadata:', '  name: ledger-secrets', 'data:', '  ADMIN_PORT: OTQ3Nw==', 'stringData:', '  DB_PASSWORD: hunter2-not-a-port', '  SIDE_PORT: "9499"'),
      'k8s/ledger-ports.yaml': lines('apiVersion: v1', 'kind: Secret', 'metadata:', '  name: ledger-ports', 'data:', '  http: OTQ4OA=='),
    });
    const read = readProjectSettings({ services: [{ name: 'ledger', dir: join(dir, 'ledger') }], rootDir: dir });
    const [routed] = read['ledger']?.routes ?? [];
    expect(routed?.environmentSecret).toEqual(['ADMIN_PORT', 'DB_PASSWORD', 'METRICS_PORT', 'PORT', 'SIDE_PORT']);
    expect(routed?.environmentSecretFrom).toEqual({
      ADMIN_PORT: { secret: 'ledger-secrets', key: 'ADMIN_PORT', file: 'k8s/ledger-secrets.yaml' },
      DB_PASSWORD: { secret: 'ledger-secrets', key: 'DB_PASSWORD', file: 'k8s/ledger-secrets.yaml' },
      METRICS_PORT: { secret: 'made-elsewhere', key: 'metrics' },
      PORT: { secret: 'ledger-ports', key: 'http', file: 'k8s/ledger-ports.yaml' },
      SIDE_PORT: { secret: 'ledger-secrets', key: 'SIDE_PORT', file: 'k8s/ledger-secrets.yaml' },
    });
    const text = JSON.stringify(read);
    for (const value of ['9477', '9488', '9499', 'OTQ3Nw', 'OTQ4OA', 'hunter2']) expect(text).not.toContain(value);
  });
});

describe('a script run in another package of the workspace, and an included Makefile (P350)', () => {
  const services = (dir: string, ...names: string[]) => names.map((name) => ({ name, dir: join(dir, name) }));

  it("follows pnpm's --filter and -F, -C, npm's --workspace and yarn's workspace to that package's script", () => {
    const dir = project({
      'package.json': JSON.stringify({ name: 'shop', private: true, workspaces: ['orders', 'billing', 'stock', 'ledger', 'audit'] }),
      'scripts/up.sh': lines(
        'export PORT=4710',
        'pnpm --filter @shop/orders dev',
        'export PORT=4720',
        'pnpm -F ./billing serve:api',
        'export PORT=4730',
        'npm run start -w @shop/stock',
        'export PORT=4740',
        'yarn workspace @shop/ledger run api',
        'export PORT=4750',
        'pnpm -C audit api',
      ),
      'orders/package.json': JSON.stringify({ name: '@shop/orders', scripts: { dev: 'tsx watch src/main.ts' } }),
      'billing/package.json': JSON.stringify({ name: '@shop/billing', scripts: { 'serve:api': 'node src/main.js' } }),
      'stock/package.json': JSON.stringify({ name: '@shop/stock', scripts: { start: 'node src/main.js' } }),
      'ledger/package.json': JSON.stringify({ name: '@shop/ledger', scripts: { api: 'tsx src/main.ts' } }),
      'audit/package.json': JSON.stringify({ name: '@shop/audit', scripts: { api: 'node src/main.js' } }),
    });
    const read = readProjectSettings({ services: services(dir, 'orders', 'billing', 'stock', 'ledger', 'audit'), rootDir: dir });
    expect(['orders', 'billing', 'stock', 'ledger', 'audit'].map((name) => read[name]?.ports?.['PORT']?.map((each) => each.port))).toEqual([[4710], [4720], [4730], [4740], [4750]]);
  });

  it("reads the server an included Makefile's recipe starts with the including file's exports and its goal's", () => {
    const dir = project({
      Makefile: lines('export PORT := 4800', 'include mk/*.mk', 'dev: export PORT = 4810', 'dev: orders'),
      'mk/orders.mk': lines('orders:', '\tcd orders && npm start'),
      'orders/package.json': JSON.stringify({ name: 'orders', scripts: { start: 'node src/main.js' } }),
    });
    const read = readProjectSettings({ services: services(dir, 'orders'), rootDir: dir });
    expect(read['orders']?.ports?.['PORT']).toEqual([
      { port: 4800, file: 'mk/orders.mk', started: true },
      { port: 4810, file: 'mk/orders.mk', started: true },
    ]);
  });
});

describe("a program listening through a workspace package, and a Makefile's goals and conditionals (P356)", () => {
  const services = (dir: string, ...names: string[]) => names.map((name) => ({ name, dir: join(dir, name) }));

  it("follows a program's import of a workspace package to the source the workspace links, its build mapped to its src", () => {
    const dir = project({
      'package.json': JSON.stringify({ name: 'shop', private: true, workspaces: ['orders', 'packages/*'] }),
      'scripts/up.sh': lines('export PORT=4910', 'node orders/bin/start.js'),
      'orders/package.json': JSON.stringify({ name: '@shop/orders' }),
      'orders/bin/start.js': "require('@shop/server');\n",
      'packages/server/package.json': JSON.stringify({ name: '@shop/server', main: 'dist/index.js' }),
      'packages/server/src/index.ts': "import { createApp } from './app';\ncreateApp().listen(process.env.PORT);\n",
      'scripts/other.sh': lines('export PORT=4920', 'node orders/bin/other.js'),
      'orders/bin/other.js': "import 'left-pad';\n",
    });
    const read = readProjectSettings({ services: [...services(dir, 'orders'), { name: 'server', dir: join(dir, 'packages/server') }], rootDir: dir });
    expect(read['server']?.ports?.['PORT']).toEqual([{ port: 4910, file: 'scripts/up.sh', started: true }]);
    // A package the workspace does not hold is an install's, not followed: the program's own service is given the port.
    expect(read['orders']?.ports?.['PORT']).toEqual([{ port: 4920, file: 'scripts/other.sh', started: true }]);
  });

  it('gives each goal the port its conditionals settle, and says a port read under one the files do not settle', () => {
    const dir = project({
      Makefile: lines(
        'ifeq ($(MAKECMDGOALS),dev)',
        'export PORT = 4930',
        'else',
        'export PORT = 4931',
        'endif',
        'ifdef CI',
        'export ADMIN_PORT = 4932',
        'endif',
        'dev serve:',
        '\tcd orders && npm start',
      ),
      'orders/package.json': JSON.stringify({ name: 'orders', scripts: { start: 'node src/main.js' } }),
    });
    const read = readProjectSettings({ services: services(dir, 'orders'), rootDir: dir });
    expect(read['orders']?.ports?.['PORT']?.map((each) => each.port)).toEqual([4930, 4931]);
    expect(read['orders']?.ports?.['ADMIN_PORT']?.map((each) => each.port)).toEqual([4932]);
    expect(read['orders']?.rows?.map((row) => `${row.reason} ${row.message}`)).toEqual([
      'make-conditional-unsettled Makefile:10 starts orders with PORT=4930, ADMIN_PORT=4932 under ifdef CI (Makefile:6), which the files do not settle: each branch is read, and this is the port one of them gives',
      'make-conditional-unsettled Makefile:10 starts orders with PORT=4931, ADMIN_PORT=4932 under ifdef CI (Makefile:6), which the files do not settle: each branch is read, and this is the port one of them gives',
    ]);
  });
});
