import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  forgetPackageIndexes,
  loadConfig,
  readStandInsOfBuild,
  STAND_INS_FILENAME,
  standInsOfBuild,
  WORK_COUNTS,
  type RepoGraph,
} from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildProject, serviceGraphPath } from './build.js';
import { runExtract } from './extract.js';

/**
 * The stand-ins of P78 are worked out once a build (P82): the package index
 * and the shape files, in the build, handed to every reader it starts by a
 * file in its output. A reader started by hand works them out itself and
 * comes to the same graph.
 */

const FIXED = '2026-01-01T00:00:00.000Z';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-stand-ins-once-')));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (path: string, body: unknown): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};

const TSCONFIG = { compilerOptions: { strict: false, module: 'commonjs', types: [] }, include: ['src'] };

// Three repositories with nothing installed: two that import the library and
// a client nobody has the source of, and the library itself.
for (const name of ['loans', 'orders']) {
  write(`${name}/package.json`, { name, dependencies: { '@acme/money': '^1.0.0', '@acme/queue': '^1.0.0' } });
  write(`${name}/tsconfig.json`, TSCONFIG);
  write(
    `${name}/src/main.ts`,
    [
      "import { Money } from '@acme/money';",
      "import { Queue } from '@acme/queue';",
      'export const queue = new Queue();',
      `export const sent = queue.publish('${name}.done', new Money(3).format());`,
      '',
    ].join('\n'),
  );
}
write('money/package.json', { name: '@acme/money', version: '1.0.0', main: 'dist/index.js', types: 'dist/index.d.ts' });
write('money/tsconfig.json', TSCONFIG);
write('money/src/index.ts', "export { Money } from './money';\n");
write('money/src/money.ts', 'export class Money { constructor(readonly amount: number) {} format(): string { return String(this.amount); } }\n');
write('shapes/queue.d.ts', "declare module '@acme/queue' { export class Queue { publish(topic: string, body: unknown): Promise<void>; } }\n");
write('flowatlas.config.json', {
  services: [
    { name: 'loans', repo: './loans', type: 'nestjs' },
    { name: 'orders', repo: './orders', type: 'nestjs' },
    { name: 'money-lib', repo: './money', type: 'nestjs' },
  ],
  shapes: ['./shapes/*.d.ts'],
  output: '.flowatlas',
});

const configPath = join(root, 'flowatlas.config.json');

/** A graph as two readings are compared: through JSON, without the time it was made. */
const comparable = (graph: RepoGraph): unknown => {
  const { generatedAt: _, ...rest } = JSON.parse(JSON.stringify(graph)) as RepoGraph;
  return rest;
};

const readAlone = async (service: string, options: { standIns?: string } = {}) =>
  (
    await runExtract(join(root, service === 'money-lib' ? 'money' : service), {
      config: configPath,
      out: join(root, 'alone', service),
      cache: false,
      ...options,
    })
  ).graph;

describe('the stand-ins a build works out once', () => {
  it('are written beside the graphs, and every reader comes to the graph a reader alone does', async () => {
    const result = await buildProject({ config: configPath, builtAt: FIXED, cache: false });
    expect(result.failed).toBe(false);
    const read = readStandInsOfBuild(join(result.outputDir, STAND_INS_FILENAME));
    if (!('given' in read)) throw new Error(read.problem);
    expect(Object.keys(read.given.perService).sort()).toEqual(['loans', 'money-lib', 'orders']);
    expect(read.given.indexes.folders?.sources.map((source) => source.name)).toContain('@acme/money');
    expect(read.given.shapeFiles.map((reading) => reading.path)).toEqual([join(root, 'shapes/queue.d.ts')]);

    for (const service of ['loans', 'orders', 'money-lib']) {
      const built = JSON.parse(readFileSync(serviceGraphPath(result.outputDir, service), 'utf8')) as RepoGraph;
      expect(comparable(await readAlone(service))).toEqual(comparable(built));
    }
    const loans = JSON.parse(readFileSync(serviceGraphPath(result.outputDir, 'loans'), 'utf8')) as RepoGraph;
    expect(loans.unresolved.some((row) => row.reason === 'package-from-repo')).toBe(true);
  });

  it('indexes the packages and parses the shape files once a build, not once a reader', async () => {
    const config = loadConfig(configPath).config;
    forgetPackageIndexes();
    const before = { ...WORK_COUNTS };
    const path = join(root, 'given', STAND_INS_FILENAME);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(standInsOfBuild(config, root)));
    const built = { ...WORK_COUNTS };
    expect(built.packageIndexes - before.packageIndexes).toBe(1);
    expect(built.shapeFilesRead - before.shapeFilesRead).toBe(1);

    const given = new Map<string, RepoGraph>();
    for (const service of ['loans', 'orders', 'money-lib']) {
      // Forgotten before each reader, as a reader in a process of its own
      // starts with nothing remembered: only the file can spare it the work.
      forgetPackageIndexes();
      given.set(service, await readAlone(service, { standIns: path }));
    }
    expect(WORK_COUNTS.packageIndexes).toBe(built.packageIndexes);
    expect(WORK_COUNTS.shapeFilesRead).toBe(built.shapeFilesRead);

    for (const service of ['loans', 'orders', 'money-lib']) {
      forgetPackageIndexes();
      expect(comparable(await readAlone(service))).toEqual(comparable(given.get(service) as RepoGraph));
    }
  });

  it("are the build's word: a reader handed an index with no packages mounts none", async () => {
    const config = loadConfig(configPath).config;
    const payload = standInsOfBuild(config, root);
    const path = join(root, 'empty', STAND_INS_FILENAME);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...payload, indexes: { folders: { sources: [], ambiguous: [] } } }));
    const graph = await readAlone('loans', { standIns: path });
    expect(graph.unresolved.some((row) => row.reason === 'package-from-repo')).toBe(false);
  });

  it('are worked out by a reader handed a file of another version, which it does not trust', async () => {
    const config = loadConfig(configPath).config;
    const path = join(root, 'stale', STAND_INS_FILENAME);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...standInsOfBuild(config, root), standInsFormatVersion: 2, indexes: {} }));
    forgetPackageIndexes();
    const before = { ...WORK_COUNTS };
    const graph = await readAlone('loans', { standIns: path });
    expect(WORK_COUNTS.packageIndexes - before.packageIndexes).toBe(1);
    expect(WORK_COUNTS.shapeFilesRead - before.shapeFilesRead).toBe(1);
    expect(graph.unresolved.some((row) => row.reason === 'package-from-repo')).toBe(true);
  });
});
