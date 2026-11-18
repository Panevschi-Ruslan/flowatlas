import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeIncludes, readComposeFile } from './compose.js';
import { composeRunsOf, dockerRunsOf, expandWord, serverStartsOf } from './docker-run.js';
import { readProjectSettings } from './read.js';

const lines = (...each: string[]): string => each.join('\n');

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
const project = (files: Record<string, string>): string => {
  root = mkdtempSync(join(tmpdir(), 'flowatlas-compose-shell-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const at = { file: 'scripts/up.sh', line: 3, dirs: ['.'] };

describe("a command's own shell (P337)", () => {
  it('fills a word from what the shell gives, and leaves what it does not as written', () => {
    expect(expandWord('${PORT}:3000', { PORT: '4000' })).toBe('4000:3000');
    expect(expandWord('$ENV_FILE', { ENV_FILE: 'dev.env' })).toBe('dev.env');
    expect(expandWord('${PORT:-8080}', {})).toBe('${PORT:-8080}');
    expect(expandWord('${PORT:-8080}', { PORT: '' })).toBe('${PORT:-8080}');
  });

  it('reads COMPOSE_ENV_FILES and COMPOSE_FILE where the command names no file, and its shell for the interpolation', () => {
    expect(composeRunsOf([{ ...at, words: ['docker', 'compose', 'up'], env: { COMPOSE_ENV_FILES: 'a.env,b.env', COMPOSE_FILE: 'one.yml:two.yml', SHOP_PORT: '8095' } }])).toEqual([
      { files: ['one.yml', 'two.yml'], envFiles: ['a.env', 'b.env'], shell: { COMPOSE_ENV_FILES: 'a.env,b.env', COMPOSE_FILE: 'one.yml:two.yml', SHOP_PORT: '8095' }, file: 'scripts/up.sh', line: 3, dirs: ['.'] },
    ]);
    // An option written on the command wins over the variable.
    expect(composeRunsOf([{ ...at, words: ['docker', 'compose', '--env-file', 'c.env', 'up'], env: { COMPOSE_ENV_FILES: 'a.env' } }])[0]?.envFiles).toEqual(['c.env']);
    // A file the shell names, exported earlier in the script, is settled.
    expect(composeRunsOf([{ ...at, words: ['docker', 'compose', '--env-file', '$ENV_FILE', 'up'], env: { ENV_FILE: 'dev.env' } }])[0]).toEqual(expect.objectContaining({ envFiles: ['dev.env'] }));
    expect(composeRunsOf([{ ...at, words: ['docker', 'compose', 'up'], env: { COMPOSE_ENV_FILES: '$FILES' } }])[0]?.unsettled).toBe(true);
  });

  it("passes on what the shell gives a docker run's -e NAME and its ports", () => {
    const [run] = dockerRunsOf([{ ...at, words: ['docker', 'run', '-p', '${PORT}:3000', '-e', 'PORT', 'orders'], env: { PORT: '4000' } }]);
    expect(run?.mappings).toEqual([{ published: 4000, container: 3000, line: 3 }]);
    expect(run?.environment).toEqual([{ name: 'PORT', raw: '4000' }]);
  });

  it('reads a command that starts a server with its shell, and no pipeline, build or install', () => {
    const env = { PORT: '4600' };
    const starts = (words: string[], file = 'run.sh') => serverStartsOf([{ file, line: 1, words, env }]).length;
    expect(starts(['npm', 'start'])).toBe(1);
    expect(starts(['pnpm', 'run', 'dev'])).toBe(1);
    expect(starts(['node', 'dist/main.js'])).toBe(1);
    expect(starts(['npx', 'tsx', 'src/main.ts'])).toBe(1);
    expect(starts(['next', 'start'])).toBe(1);
    expect(starts(['npm', 'install'])).toBe(0);
    expect(starts(['npm', 'run', 'build'])).toBe(0);
    expect(starts(['bun', 'test'])).toBe(0);
    expect(starts(['npm', 'start'], '.github/workflows/ci.yml')).toBe(0);
    expect(serverStartsOf([{ file: 'run.sh', line: 1, words: ['npm', 'start'], env: {} }])).toEqual([]);
  });

  it('keeps what a command runs: the file a runtime is handed, a program or a script the start list does not know (P343)', () => {
    const env = { PORT: '4600' };
    const runs = (words: string[]) => serverStartsOf([{ file: 'run.sh', line: 1, words, env }])[0]?.runs;
    expect(runs(['node', '--env-file', '.env', './scripts/serve.js'])).toEqual({ kind: 'known', file: './scripts/serve.js' });
    expect(runs(['tsx', 'watch', '--tsconfig', 'tsconfig.json', 'src/server.ts'])).toEqual({ kind: 'known', file: 'src/server.ts' });
    expect(runs(['npm', 'start'])).toEqual({ kind: 'known' });
    expect(runs(['./bin/server', '--verbose'])).toEqual({ kind: 'program', program: './bin/server' });
    expect(runs(['pnpm', 'exec', 'shop-api'])).toEqual({ kind: 'program', program: 'shop-api' });
    expect(runs(['npm', 'run', 'api'])).toEqual({ kind: 'script', name: 'api' });
    expect(runs(['yarn', 'api'])).toEqual({ kind: 'script', name: 'api' });
    expect(runs(['npm', 'api'])).toBeUndefined();
    expect(runs(['pnpm', 'publish'])).toBeUndefined();
    expect(runs(['$SERVER'])).toBeUndefined();
  });
});

describe('compose run by a script with its shell, COMPOSE_ENV_FILES and the .env (P337)', () => {
  const compose = lines('services:', '  shop:', '    build: ./shop', '    ports:', '      - "${SHOP_PORT:-8099}:3000"');

  it("interpolates with what a script exported before it ran compose, over the files, and not with an export after", () => {
    const dir = project({
      'scripts/up.sh': lines('export SHOP_PORT=8095', 'docker compose up', 'export SHOP_PORT=8096'),
      '.env': 'SHOP_PORT=8070\n',
      'docker-compose.yml': compose,
    });
    const read = readProjectSettings({ services: [{ name: 'shop', dir: join(dir, 'shop') }], rootDir: dir });
    expect(read['shop']?.containers?.[0]?.ports.map((port) => port.published)).toEqual([8095]);
  });

  it('reads COMPOSE_ENV_FILES written before the command, or in the .env, in place of the .env', () => {
    const inline = project({
      Makefile: lines('up:', '\tCOMPOSE_ENV_FILES=ports.env docker compose up'),
      '.env': 'SHOP_PORT=8070\n',
      'ports.env': 'SHOP_PORT=8091\n',
      'docker-compose.yml': compose,
    });
    expect(readProjectSettings({ services: [{ name: 'shop', dir: join(inline, 'shop') }], rootDir: inline })['shop']?.containers?.[0]?.ports.map((port) => port.published)).toEqual([8091]);
    rmSync(inline, { recursive: true, force: true });
    const dotEnv = project({
      '.env': 'COMPOSE_ENV_FILES=ports.env,ports.local.env\nSHOP_PORT=8070\n',
      'ports.env': 'SHOP_PORT=8091\n',
      'ports.local.env': 'SHOP_PORT=8092\n',
      'docker-compose.yml': compose,
    });
    expect(readProjectSettings({ services: [{ name: 'shop', dir: join(dotEnv, 'shop') }], rootDir: dotEnv })['shop']?.containers?.[0]?.ports.map((port) => port.published)).toEqual([8092]);
  });
});

describe("compose's include: and extends: (P337)", () => {
  it('lists what a file includes, its env files and project directory', () => {
    expect(composeIncludes(lines('include:', '  - infra.yaml', '  - path: [deploy/a.yaml, deploy/b.yaml]', '    env_file: deploy/ports.env', '    project_directory: deploy', '  - $SHELL_NAMED.yaml'))).toEqual([
      { paths: ['infra.yaml'], envFiles: [] },
      { paths: ['deploy/a.yaml', 'deploy/b.yaml'], envFiles: ['deploy/ports.env'], projectDirectory: 'deploy' },
    ]);
  });

  it('writes a service over the one it extends, in the same file and in another, its paths rebased', () => {
    const files: Record<string, string> = {
      'compose/common.yml': lines('services:', '  node:', '    env_file: node.env', '    environment:', '      PORT: 3000', '      LOG_PORT: 9000', '    ports:', '      - "9100:9000"'),
    };
    const services = readComposeFile(
      lines(
        'services:',
        '  base:',
        '    environment: [ "PORT=3500" ]',
        '  orders:',
        '    extends:',
        '      file: compose/common.yml',
        '      service: node',
        '    build: ./orders',
        '    environment:',
        '      LOG_PORT: 9001',
        '    ports:',
        '      - "8101:3000"',
        '  billing:',
        '    extends: base',
        '    build: ./billing',
      ),
      {},
      (path) => files[path],
    );
    const orders = services.find((each) => each.name === 'orders');
    expect(orders?.envFiles).toEqual(['compose/node.env']);
    expect(orders?.environment).toEqual([
      { name: 'PORT', raw: '3000' },
      { name: 'LOG_PORT', raw: '9001' },
    ]);
    expect(orders?.mappings.map((mapping) => [mapping.published, mapping.container])).toEqual([
      [9100, 9000],
      [8101, 3000],
    ]);
    expect(orders?.context).toBe('./orders');
    expect(services.find((each) => each.name === 'billing')?.environment).toEqual([{ name: 'PORT', raw: '3500' }]);
  });

  it("reads an included file with its own env file under the including file's variables, its build paths its own, once", () => {
    const dir = project({
      'docker-compose.yml': lines('include:', '  - deploy/catalog.compose.yaml', '  - path: deploy/search.compose.yaml', '    env_file: deploy/search.env', 'services:', '  shop:', '    build: ./shop'),
      'deploy/catalog.compose.yaml': lines('services:', '  catalog:', '    build: ../catalog', '    ports:', '      - "${CATALOG_PORT:-8099}:4000"'),
      'deploy/.env': 'CATALOG_PORT=8103\n',
      'deploy/search.compose.yaml': lines('services:', '  search:', '    build: ../search', '    ports:', '      - "${SEARCH_PORT:-8099}:4000"'),
      'deploy/search.env': 'SEARCH_PORT=8104\n',
    });
    const services = ['shop', 'catalog', 'search'].map((name) => ({ name, dir: join(dir, name) }));
    const read = readProjectSettings({ services, rootDir: dir });
    expect(read['catalog']?.containers?.map((each) => [each.file, each.ports.map((port) => port.published)])).toEqual([['deploy/catalog.compose.yaml', [8103]]]);
    expect(read['search']?.containers?.map((each) => each.ports.map((port) => port.published))).toEqual([[8104]]);
  });

  it('reads extends from another file of the project with its env file, and the env file rebased', () => {
    const dir = project({
      'docker-compose.yml': lines('services:', '  orders:', '    extends: { file: compose/common.yml, service: node }', '    build: ./orders', '    ports:', '      - "8101:3000"'),
      'compose/common.yml': lines('services:', '  node:', '    env_file: node.env'),
      'compose/node.env': 'PORT=3000\n',
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    const [orders] = read['orders']?.containers ?? [];
    expect(orders?.environment).toEqual({ PORT: 3000 });
    expect(orders?.environmentFiles).toEqual({ PORT: 'compose/node.env' });
  });
});

describe('a server a script starts with its exported variables (P337)', () => {
  it("gives the service's setting the port, firmly, only after the export and only in that script", () => {
    const dir = project({
      // `cd` holds for the lines after it, as the shell's does.
      'run-stock.sh': lines('#!/bin/sh', 'cd ledger', 'npm start', 'cd ../stock', 'export PORT=4600', 'npm start'),
      'run-other.sh': lines('cd ledger', 'npm start'),
      'stock/package.json': JSON.stringify({ name: 'stock', scripts: { start: 'node dist/main.js' } }),
      'ledger/package.json': JSON.stringify({ name: 'ledger', scripts: { start: 'node dist/main.js' } }),
    });
    const read = readProjectSettings({
      services: [
        { name: 'stock', dir: join(dir, 'stock') },
        { name: 'ledger', dir: join(dir, 'ledger') },
      ],
      rootDir: dir,
    });
    expect(read['stock']?.ports?.['PORT']).toEqual([{ port: 4600, file: 'run-stock.sh', started: true }]);
    expect(read['ledger']?.ports?.['PORT']).toBeUndefined();
  });

  it("reads a package.json script's own environment, and no secret's name", () => {
    const dir = project({ 'orders/package.json': JSON.stringify({ name: 'orders', scripts: { dev: 'PORT=4700 ADMIN_TOKEN_PORT=4701 tsx watch src/main.ts' } }) });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.ports).toEqual({ PORT: [{ port: 4700, file: 'package.json', started: true }] });
  });
});

describe("a cluster workload's environment over its image's (P337)", () => {
  const deployment = (name: string, image: string, container: readonly string[]): string =>
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
      ...container,
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
      '      targetPort: 7000',
    );

  it("layers a config map's keys over the Dockerfile's, each said at its own file, and a secret's by name only", () => {
    const dir = project({
      Makefile: lines('image:', '\tdocker build -t ledger ledger'),
      'ledger/Dockerfile': lines('FROM node:22', 'ENV PORT=6500 METRICS_PORT=9100 ADMIN_PORT=9300'),
      'k8s/ledger.yaml': deployment('ledger', 'registry.example.test/shop/ledger:1.0', [
        '          envFrom:',
        '            - configMapRef:',
        '                name: ledger-config',
        '            - secretRef:',
        '                name: ledger-secrets',
        '          env:',
        '            - name: METRICS_PORT',
        '              value: "9200"',
      ]),
      'k8s/ledger-config.yaml': lines('apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: ledger-config', 'data:', '  PORT: "7000"'),
      'k8s/ledger-secrets.yaml': lines('apiVersion: v1', 'kind: Secret', 'metadata:', '  name: ledger-secrets', 'stringData:', '  ADMIN_PORT: "9400"'),
    });
    const read = readProjectSettings({ services: [{ name: 'ledger', dir: join(dir, 'ledger') }], rootDir: dir });
    const [routed] = read['ledger']?.routes ?? [];
    expect(routed?.environment).toEqual({ PORT: 7000, METRICS_PORT: 9200 });
    // Said where the first port is written, the config map, and the value written in the pod spec there.
    expect(routed?.environmentFrom).toBe('k8s/ledger-config.yaml');
    expect(routed?.environmentFiles).toEqual({ METRICS_PORT: 'k8s/ledger.yaml' });
    expect(routed?.environmentSecret).toEqual(['ADMIN_PORT']);
  });

  it("says a chart's image the values do not settle is unread", () => {
    const dir = project({
      'deploy/charts/audit/Chart.yaml': 'apiVersion: v2\nname: audit\nversion: 0.1.0\n',
      'deploy/charts/audit/values.yaml': 'replicas: 1\n',
      'deploy/charts/audit/templates/audit.yaml': deployment('audit', '"{{ .Values.image.repository }}:{{ .Values.image.tag }}"', []),
      Makefile: lines('deploy:', '\thelm upgrade --install audit deploy/charts/audit'),
    });
    const read = readProjectSettings({ services: [{ name: 'audit', dir: join(dir, 'audit') }], rootDir: dir });
    expect(read['audit']?.routes?.[0]?.imageUnread).toEqual({
      image: '{{ … }}:',
      why: "its name is a template value the chart's values and the files do not settle, and an image is never fetched",
    });
  });
});
