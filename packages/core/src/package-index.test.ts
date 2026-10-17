import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import { forgetPackageIndexes, packageIndexOf, rangeIncludes } from './package-index.js';
import { readStandInsOfBuild, standInsFor, standInsOfBuild, type StandInsOfBuild } from './stand-ins.js';
import { WORK_COUNTS } from './work-counts.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const treeOf = (files: Record<string, unknown>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-index-')));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
};

const writeTo = (root: string, name: string, body: unknown): string => {
  const path = join(root, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
};

describe('packageIndexOf', () => {
  it('names each configured repository and every member of a workspace inside one', () => {
    const root = treeOf({
      'money/package.json': { name: '@acme/money', version: '1.4.0' },
      'kit/package.json': { name: 'kit', private: true, workspaces: ['packages/*'] },
      'kit/packages/queue/package.json': { name: '@acme/queue', version: '2.0.1' },
      'loans/package.json': { name: 'loans' },
    });
    const index = packageIndexOf({
      services: [
        { name: 'money-lib', dir: join(root, 'money') },
        { name: 'kit', dir: join(root, 'kit') },
        { name: 'loans', dir: join(root, 'loans') },
      ],
    });
    expect(index.sources.get('@acme/money')).toMatchObject({ dir: join(root, 'money'), version: '1.4.0', service: 'money-lib', origin: 'service' });
    expect(index.sources.get('@acme/queue')).toMatchObject({ dir: join(root, 'kit/packages/queue'), service: 'kit', origin: 'member' });
    expect(index.sources.has('loans')).toBe(true);
    expect(index.ambiguous.size).toBe(0);
  });

  it('keeps a name two repositories claim apart, and reads neither', () => {
    const root = treeOf({
      'a/package.json': { name: '@acme/money', version: '1.0.0' },
      'b/package.json': { name: '@acme/money', version: '1.1.0' },
    });
    const index = packageIndexOf({
      services: [
        { name: 'a', dir: join(root, 'a') },
        { name: 'b', dir: join(root, 'b') },
      ],
    });
    expect(index.sources.has('@acme/money')).toBe(false);
    expect(index.ambiguous.get('@acme/money')?.map((source) => source.service)).toEqual(['a', 'b']);
  });

  it('looks under the configuration only for what no repository names, and lets a repository win', () => {
    const root = treeOf({
      'money/package.json': { name: '@acme/money' },
      'money-copy/package.json': { name: '@acme/money' },
      'flags/package.json': { name: '@acme/flags', version: '0.3.0' },
      'node_modules/x/package.json': { name: 'x' },
      '.hidden/package.json': { name: 'hidden' },
    });
    const index = packageIndexOf({ services: [{ name: 'money', dir: join(root, 'money') }], folders: root });
    expect(index.sources.get('@acme/money')?.dir).toBe(join(root, 'money'));
    expect(index.sources.get('@acme/flags')).toMatchObject({ origin: 'folder', version: '0.3.0' });
    expect(index.sources.has('x')).toBe(false);
    expect(index.sources.has('hidden')).toBe(false);
    expect(index.ambiguous.size).toBe(0);
  });
});

describe('rangeIncludes', () => {
  it.each([
    ['^1.2.0', '1.4.0', true],
    ['^2.0.0', '1.4.0', false],
    ['^0.2.1', '0.2.9', true],
    ['^0.2.1', '0.3.0', false],
    ['~1.2.0', '1.2.7', true],
    ['~1.2.0', '1.3.0', false],
    ['>=1.0.0 <2.0.0', '1.9.9', true],
    ['1.x', '1.7.0', true],
    ['1.2.3', '1.2.3', true],
    ['1.0.0 - 1.5.0', '1.6.0', false],
    ['^1.0.0 || ^3.0.0', '3.1.0', true],
    ['*', '9.0.0', true],
    ['workspace:*', '0.0.1', true],
    ['workspace:^1.0.0', '2.0.0', false],
  ])('%s includes %s: %s', (range, version, expected) => {
    expect(rangeIncludes(range, version)).toBe(expected);
  });

  it('says nothing about a range it does not read', () => {
    expect(rangeIncludes('file:../money', '1.0.0')).toBeUndefined();
    expect(rangeIncludes('github:acme/money', '1.0.0')).toBeUndefined();
    expect(rangeIncludes('^1.0.0', 'not-a-version')).toBeUndefined();
  });
});

describe('the stand-ins a build works out once (P82)', () => {
  const tree = () =>
    treeOf({
      'loans/package.json': { name: 'loans', dependencies: { '@acme/money': '^2.0.0' } },
      'money/package.json': { name: '@acme/money', version: '1.4.0', main: 'dist/index.js' },
      'kit/package.json': { name: 'kit', private: true, workspaces: ['packages/*'] },
      'kit/packages/queue/package.json': { name: '@acme/queue', version: '2.0.1' },
      'copy-a/package.json': { name: '@acme/flags' },
      'copy-b/package.json': { name: '@acme/flags' },
      'shapes/queue.d.ts': "declare module '@acme/bus' { export class Bus { send(): void; } }\n",
      'shapes/broken.d.ts': 'declare module {\n',
      'loans/own.d.ts': "declare module '@acme/own' { export const own: number; }\n",
    });
  const CONFIG = {
    services: [
      { name: 'loans', repo: './loans', type: 'nestjs', shapes: ['./loans/own.d.ts'] },
      { name: 'money-lib', repo: './money', type: 'nestjs', packageSources: 'services' },
      { name: 'kit', repo: './kit', type: 'nestjs', packageSources: false },
    ],
    shapes: ['./shapes/*.d.ts'],
  };

  it('hands every service the request working it out in place would have made', () => {
    const root = tree();
    const config = parseConfig(CONFIG);
    const payload = JSON.parse(JSON.stringify(standInsOfBuild(config, root))) as unknown;
    const read = readStandInsOfBuild(writeTo(root, 'stand-ins.json', payload));
    expect('given' in read).toBe(true);
    const given = (read as { given: StandInsOfBuild }).given;
    for (const service of config.services) {
      const computed = standInsFor({ config, service, configDir: root });
      expect(standInsFor({ config, service, configDir: root, given })).toEqual(computed);
    }
  });

  it('indexes only the searches a service asks, and reads a shape file two services list once', () => {
    const root = tree();
    forgetPackageIndexes();
    const before = { ...WORK_COUNTS };
    const payload = standInsOfBuild(parseConfig(CONFIG), root);
    expect(Object.keys(payload.indexes).sort()).toEqual(['folders', 'services']);
    expect(payload.shapeFiles.map((reading) => reading.path)).toEqual([
      join(root, 'loans/own.d.ts'),
      join(root, 'shapes/broken.d.ts'),
      join(root, 'shapes/queue.d.ts'),
    ]);
    expect(WORK_COUNTS.packageIndexes - before.packageIndexes).toBe(2);
    expect(WORK_COUNTS.shapeFilesRead - before.shapeFilesRead).toBe(3);
    const off = standInsOfBuild(parseConfig({ ...CONFIG, packageSources: false, services: CONFIG.services.map(({ packageSources: _, ...rest }) => rest) }), root);
    expect(off.indexes).toEqual({});
  });

  it('is not read when it is of another version, broken, or made for another directory', () => {
    const root = tree();
    const config = parseConfig(CONFIG);
    const payload = standInsOfBuild(config, root);
    expect(readStandInsOfBuild(writeTo(root, 'v2.json', { ...payload, standInsFormatVersion: 2 }))).toMatchObject({
      problem: expect.stringContaining('format 2'),
    });
    expect(readStandInsOfBuild(writeTo(root, 'bad.json', '{'))).toMatchObject({ problem: expect.stringContaining('not JSON') });
    expect(readStandInsOfBuild(join(root, 'gone.json'))).toMatchObject({ problem: expect.stringContaining('cannot be read') });
    expect(readStandInsOfBuild(writeTo(root, 'odd.json', { ...payload, indexes: 3 }))).toMatchObject({
      problem: expect.stringContaining('not a stand-ins file'),
    });
    // Made against another configuration directory: worked out here instead.
    const service = config.services[0];
    forgetPackageIndexes();
    const before = WORK_COUNTS.packageIndexes;
    const elsewhere = { ...payload, configDir: join(root, 'elsewhere') };
    expect(standInsFor({ config, service, configDir: root, given: elsewhere })).toEqual(
      standInsFor({ config, service, configDir: root }),
    );
    expect(WORK_COUNTS.packageIndexes - before).toBe(1);
  });
});
