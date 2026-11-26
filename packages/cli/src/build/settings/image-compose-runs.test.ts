import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { interpolationValue } from '@flowatlas/core';
import { afterEach, describe, expect, it } from 'vitest';
import { readComposeFile } from './compose.js';
import { composeRunsOf } from './docker-run.js';
import { readProjectSettings } from './read.js';
import { readSkaffoldFile } from './skaffold.js';

const lines = (...each: string[]): string => each.join('\n');

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
const project = (files: Record<string, string>): string => {
  root = mkdtempSync(join(tmpdir(), 'flowatlas-image-compose-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const workload = (name: string, image: string, port: number, env: readonly string[] = []): string =>
  lines(
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${name}`,
    'spec:',
    '  selector:',
    '    matchLabels:',
    `      app: ${name}`,
    '  template:',
    '    metadata:',
    '      labels:',
    `        app: ${name}`,
    '    spec:',
    '      containers:',
    `        - name: ${name}`,
    `          image: ${image}`,
    ...(env.length === 0 ? [] : ['          env:', ...env]),
    '---',
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    `  name: ${name}`,
    'spec:',
    '  selector:',
    `    app: ${name}`,
    '  ports:',
    '    - port: 80',
    `      targetPort: ${port}`,
  );

describe('what a names-only file may lend an interpolation (P331)', () => {
  it('lends a port, an address cut to what the graph keeps, and a host name, under a name that is no secret', () => {
    expect(interpolationValue('API_PORT', '4100')).toBe('4100');
    expect(interpolationValue('CATALOG_HOST', 'catalog')).toBe('catalog');
    expect(interpolationValue('UPSTREAM', 'https://user:pw@shop.example.test/v1')).toBe('https://shop.example.test/v1');
    expect(interpolationValue('SESSION_SECRET', 'catalog')).toBeUndefined();
    expect(interpolationValue('GREETING', 'hello there')).toBeUndefined();
    expect(interpolationValue('NONCE', 'a1b2c3d4e5f6a7b8c9d0e1f2')).toBeUndefined();
  });
});

describe('docker compose commands (P331)', () => {
  it('reads the compose files, env files and project directory a command names before its own command', () => {
    const at = { file: 'Makefile', line: 2, dirs: ['.'] };
    expect(composeRunsOf([{ ...at, words: ['docker', 'compose', '--env-file', 'a.env', '--env-file=b.env', '-f', 'ops/compose.yml', 'up', '--env-file', 'x'] }])).toEqual([
      { files: ['ops/compose.yml'], envFiles: ['a.env', 'b.env'], file: 'Makefile', line: 2, dirs: ['.'] },
    ]);
    expect(composeRunsOf([{ ...at, words: ['docker-compose', '--project-directory', 'deploy', 'up'] }])).toEqual([{ files: [], envFiles: [], projectDirectory: 'deploy', file: 'Makefile', line: 2, dirs: ['.'] }]);
    expect(composeRunsOf([{ ...at, words: ['docker', 'compose', '--env-file', '$ENV_FILE', 'up'] }])[0]?.unsettled).toBe(true);
    // A pipeline's compose runs on the pipeline's machine.
    expect(composeRunsOf([{ file: '.github/workflows/ci.yml', line: 9, words: ['docker', 'compose', '--env-file', 'ci.env', 'up'] }])).toEqual([]);
  });

  it('interpolates a port mapping, a name, an env file and the environment', () => {
    const text = lines(
      'services:',
      '  billing:',
      '    container_name: ${PREFIX}-billing',
      '    build: ./billing',
      '    env_file: ./${STAGE:-dev}.env',
      '    ports:',
      '      - "${BILLING_PORT:-8099}:3000"',
      '      - published: ${ADMIN_PORT}',
      '        target: 3100',
      '    environment:',
      '      CATALOG_URL: http://${CATALOG_HOST}:3000',
    );
    const [billing] = readComposeFile(text, { PREFIX: 'shop', BILLING_PORT: '8090', ADMIN_PORT: '8091', CATALOG_HOST: 'catalog' });
    expect(billing?.aliases).toEqual(['shop-billing']);
    expect(billing?.envFiles).toEqual(['./dev.env']);
    expect(billing?.mappings).toEqual([
      { published: 8090, container: 3000, line: 7 },
      { published: 8091, container: 3100, line: 8 },
    ]);
    expect(billing?.environment).toEqual([{ name: 'CATALOG_URL', raw: 'http://catalog:3000' }]);
    const [unsettled] = readComposeFile(text);
    expect(unsettled?.aliases).toEqual([]);
    expect(unsettled?.mappings).toEqual([{ published: 8099, container: 3000, line: 7 }]);
    expect(unsettled?.environment).toEqual([]);
  });

  it("reads a compose file with the env files a command hands it, in place of the .env beside it, a later over an earlier, and no secret's value", () => {
    const dir = project({
      Makefile: lines('up:', '\tdocker compose --env-file compose.env --env-file compose.local.env up'),
      '.env': 'BILLING_PORT=8070\n',
      'compose.env': 'BILLING_PORT=8090\nCATALOG_HOST=catalog\nSESSION_SECRET=catalog\n',
      'compose.local.env': 'CATALOG_HOST=catalog-local\n',
      'docker-compose.yml': lines(
        'services:',
        '  billing:',
        '    build: ./billing',
        '    ports:',
        '      - "${BILLING_PORT:-8099}:3000"',
        '    environment:',
        '      CATALOG_URL: http://${CATALOG_HOST}:3000',
        '      SESSION_URL: http://${SESSION_SECRET:-sessions}:3000',
      ),
    });
    const read = readProjectSettings({ services: [{ name: 'billing', dir: join(dir, 'billing') }], rootDir: dir });
    expect(read['billing']?.containers?.[0]?.ports.map((port) => port.published)).toEqual([8090]);
    expect(read['billing']?.values['CATALOG_URL']?.map((value) => value.value)).toEqual(['http://catalog-local:3000']);
    // A secret's value is never lent: the placeholder falls back to its default.
    expect(read['billing']?.values['SESSION_URL']?.map((value) => value.value)).toEqual(['http://sessions:3000']);
  });

  it('reads only what every command running the file agrees on, and nothing where one names its file by the shell', () => {
    const files = {
      'docker-compose.yml': lines('services:', '  billing:', '    build: ./billing', '    ports:', '      - "${BILLING_PORT:-8099}:${INNER_PORT:-3000}"'),
      'dev.env': 'BILLING_PORT=8090\nINNER_PORT=3100\n',
      'ci.env': 'BILLING_PORT=8095\nINNER_PORT=3100\n',
    };
    const agreed = readProjectSettings({
      services: [{ name: 'billing', dir: join(project({ ...files, Makefile: lines('dev:', '\tdocker compose --env-file dev.env up', 'ci:', '\tdocker compose --env-file ci.env up') }), 'billing') }],
      rootDir: root as string,
    });
    expect(agreed['billing']?.containers?.[0]?.ports.map((port) => [port.published, port.container])).toEqual([[8099, 3100]]);
    rmSync(root as string, { recursive: true, force: true });
    const shell = readProjectSettings({
      services: [{ name: 'billing', dir: join(project({ ...files, Makefile: lines('dev:', '\tdocker compose --env-file dev.env up', 'any:', '\tdocker compose --env-file $(ENV) up') }), 'billing') }],
      rootDir: root as string,
    });
    expect(shell['billing']?.containers?.[0]?.ports.map((port) => [port.published, port.container])).toEqual([[8099, 3000]]);
  });
});

describe("a container's image, read where the project builds it and said to be unread where it does not (P331)", () => {
  it("reads a compose service's pulled image with the Dockerfile a command tags it from, and says a pulled image nothing builds is unread", () => {
    const dir = project({
      'stock/Makefile': lines('image:', '\tdocker build -t stock-api -f docker/Dockerfile .'),
      'stock/docker/Dockerfile': lines('FROM node:22', 'ENV PORT=4300'),
      'docker-compose.yml': lines('services:', '  stock:', '    image: stock-api:dev', '    ports:', '      - "8081:4300"', '  orders:', '    image: registry.example.test/shop/orders:1.2', '    ports:', '      - "8080:4000"'),
    });
    const read = readProjectSettings({
      services: [
        { name: 'stock', dir: join(dir, 'stock') },
        { name: 'orders', dir: join(dir, 'orders') },
      ],
      rootDir: dir,
    });
    const [stock] = read['stock']?.containers ?? [];
    expect(stock?.environment).toEqual({ PORT: 4300 });
    expect(stock?.environmentFiles).toEqual({ PORT: 'stock/docker/Dockerfile' });
    expect(stock?.imageUnread).toBeUndefined();
    expect(read['orders']?.containers?.[0]?.imageUnread).toEqual({ image: 'registry.example.test/shop/orders:1.2', why: 'nothing in the project builds it, and an image is never fetched' });
  });

  it("reads a docker run of an image a compose file builds under its image:, and says a Dockerfile not found", () => {
    const dir = project({
      'orders/package.json': JSON.stringify({ name: 'orders', scripts: { start: 'docker run -p 8080:4000 shop-orders:latest', other: 'docker run -p 8082:4000 --name other-orders unknown-orders' } }),
      'docker-compose.yml': lines('services:', '  builder:', '    image: shop-orders', '    build: ./orders', '  missing:', '    build: ./nowhere'),
      'orders/Dockerfile': lines('FROM node:22', 'ENV PORT=4000'),
    });
    const read = readProjectSettings({
      services: [
        { name: 'orders', dir: join(dir, 'orders') },
        { name: 'missing', dir: join(dir, 'missing') },
      ],
      rootDir: dir,
    });
    const [built, unknown] = read['orders']?.containers ?? [];
    expect(built?.environment).toEqual({ PORT: 4000 });
    expect(built?.environmentFiles).toEqual({ PORT: 'Dockerfile' });
    expect(unknown?.imageUnread?.image).toBe('unknown-orders');
    expect(read['missing']?.containers?.[0]?.imageUnread).toEqual({ image: 'missing', why: 'the Dockerfile compose builds it from is not found' });
  });

  it("reads a cluster workload's image a Skaffold artifact builds, under the manifest's environment, and says a pulled one is unread", () => {
    const dir = project({
      'skaffold.yaml': lines('apiVersion: skaffold/v4beta11', 'kind: Config', 'build:', '  artifacts:', '    - image: registry.example.test/shop/inventory', '      context: inventory', '      docker:', '        target: runtime', '        buildArgs:', '          APP_PORT: "5000"'),
      'inventory/Dockerfile': lines('FROM node:22 AS runtime', 'ARG APP_PORT=3000', 'ENV PORT=$APP_PORT METRICS_PORT=9100'),
      'k8s/inventory.yaml': workload('inventory', 'registry.example.test/shop/inventory:2.0', 5000, ['            - name: METRICS_PORT', '              value: "9200"']),
      'k8s/ledger.yaml': workload('ledger', 'registry.example.test/shop/ledger:1.0', 6000),
    });
    const read = readProjectSettings({
      services: [
        { name: 'inventory', dir: join(dir, 'inventory') },
        { name: 'ledger', dir: join(dir, 'ledger') },
      ],
      rootDir: dir,
    });
    const [inventory] = read['inventory']?.routes ?? [];
    expect(inventory?.environment).toEqual({ PORT: 5000, METRICS_PORT: 9200 });
    expect(inventory?.environmentFiles).toEqual({ PORT: 'Dockerfile' });
    expect(read['ledger']?.routes?.[0]?.imageUnread).toEqual({ image: 'ledger', why: 'nothing in the project builds it, and an image is never fetched' });
  });

  it('reads a Skaffold configuration of several documents and profiles, leaving other builders out', () => {
    const text = lines(
      'build:',
      '  artifacts:',
      '    - image: shop/orders',
      '    - image: shop/jvm',
      '      jib: {}',
      'profiles:',
      '  - name: dev',
      '    build:',
      '      artifacts:',
      '        - image: shop/stock',
      '          context: stock',
      '          docker:',
      '            dockerfile: docker/Dockerfile.dev',
      '---',
      'build:',
      '  artifacts:',
      '    - image: shop/billing',
    );
    expect(readSkaffoldFile(text)).toEqual([
      { name: 'orders', context: '.', dockerfile: 'Dockerfile', args: {} },
      { name: 'stock', context: 'stock', dockerfile: 'docker/Dockerfile.dev', args: {} },
      { name: 'billing', context: '.', dockerfile: 'Dockerfile', args: {} },
    ]);
  });
});

describe('a port an environment file gives on this machine (P331)', () => {
  it('marks the hosts a non-example file gives, for the linker to settle against what the code loads', () => {
    const dir = project({ 'api/.env.development': 'PORT=4050\n', 'board/.env.example': 'PORT=4060\n' });
    const read = readProjectSettings({
      services: [
        { name: 'api', dir: join(dir, 'api') },
        { name: 'board', dir: join(dir, 'board') },
      ],
      rootDir: dir,
    });
    expect(read['api']?.hosts[0]).toEqual({ host: 'localhost:4050', file: '.env.development', environmentFile: true });
    expect(read['board']?.hosts[0]).toEqual({ host: 'localhost:4060', file: '.env.example', example: true });
  });
});
