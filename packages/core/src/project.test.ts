import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject, listRepoSources, skippedTestDirectories, sourceRootsOf } from './project.js';

/**
 * A workspace package imported by its name, with nothing installed (R152).
 *
 * Each case builds a small workspace on disk and asks which file an import in
 * the service's own code lands on. The answers are about module resolution
 * alone; what a reader makes of the file is the fixture's business.
 */

const temporary: string[] = [];

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

const write = (root: string, files: Record<string, string | object>): void => {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
};

const TSCONFIG = {
  compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: false, types: [] },
};

/**
 * A workspace with a service `api` that declares `@acme/stock` and not
 * `@acme/ledger`, plus whatever a case adds.
 */
const workspace = (extra: Record<string, string | object> = {}): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-project-')));
  temporary.push(root);
  write(root, {
    'package.json': { name: 'root', private: true, workspaces: ['api', 'packages/*'] },
    'api/package.json': { name: '@acme/api', dependencies: { '@acme/stock': 'workspace:*' } },
    'api/tsconfig.json': TSCONFIG,
    'packages/stock/package.json': {
      name: '@acme/stock',
      type: 'module',
      exports: {
        '.': { types: './dist/index.d.ts', import: './src/index.js' },
        './levels/*': './src/levels/*.js',
        './escape': '../../outside/secret.ts',
        './hidden': null,
      },
    },
    'packages/stock/src/index.ts': 'export const stock = 1;\n',
    'packages/stock/src/levels/format.ts': 'export const format = 1;\n',
    'packages/ledger/package.json': { name: '@acme/ledger', exports: { '.': './src/index.ts' } },
    'packages/ledger/src/index.ts': 'export const ledger = 1;\n',
    'outside/secret.ts': 'export const secret = 1;\n',
    ...extra,
  });
  return root;
};

/** Where each import of `api/src/main.ts` lands, relative to the workspace. */
const landings = (root: string, imports: readonly string[]): Record<string, string | undefined> => {
  write(root, {
    'api/src/main.ts': imports.map((specifier, i) => `import * as m${i} from '${specifier}';\n`).join(''),
  });
  const project = createProject({ rootDir: join(root, 'api') });
  const main = project.getSourceFileOrThrow(join(root, 'api/src/main.ts'));
  return Object.fromEntries(
    main.getImportDeclarations().map((declaration) => [
      declaration.getModuleSpecifierValue(),
      declaration.getModuleSpecifierSourceFile()?.getFilePath().slice(root.length + 1),
    ]),
  );
};

describe('a workspace package imported by its name', () => {
  it('lands on the source its exports map names, when nothing is installed', () => {
    const root = workspace();
    expect(landings(root, ['@acme/stock', '@acme/stock/levels/format'])).toEqual({
      '@acme/stock': 'packages/stock/src/index.ts',
      '@acme/stock/levels/format': 'packages/stock/src/levels/format.ts',
    });
  });

  it('leaves a package the service does not declare unresolved', () => {
    expect(landings(workspace(), ['@acme/ledger'])).toEqual({ '@acme/ledger': undefined });
  });

  it('refuses a target outside the package, and a subpath the map withholds', () => {
    expect(landings(workspace(), ['@acme/stock/escape', '@acme/stock/hidden', '@acme/stock/src/index'])).toEqual({
      '@acme/stock/escape': undefined,
      '@acme/stock/hidden': undefined,
      '@acme/stock/src/index': undefined,
    });
  });

  it('refuses a path that climbs out of a package without an exports map', () => {
    const root = workspace({
      'packages/stock/package.json': { name: '@acme/stock', main: './src/index.ts' },
    });
    expect(landings(root, ['@acme/stock', '@acme/stock/../../outside/secret'])).toEqual({
      '@acme/stock': 'packages/stock/src/index.ts',
      '@acme/stock/../../outside/secret': undefined,
    });
  });

  it('lets an installed package win', () => {
    const root = workspace({
      'api/node_modules/@acme/stock/package.json': { name: '@acme/stock', types: './index.d.ts' },
      'api/node_modules/@acme/stock/index.d.ts': 'export declare const stock: number;\n',
    });
    expect(landings(root, ['@acme/stock'])).toEqual({
      '@acme/stock': 'api/node_modules/@acme/stock/index.d.ts',
    });
  });

  it('reaches every member of a workspace read from its root', () => {
    const root = workspace();
    write(root, {
      'tsconfig.json': TSCONFIG,
      'packages/stock/src/uses-ledger.ts': "import { ledger } from '@acme/ledger';\nexport const used = ledger;\n",
    });
    const project = createProject({ rootDir: root });
    const file = project.getSourceFileOrThrow(join(root, 'packages/stock/src/uses-ledger.ts'));
    expect(file.getImportDeclarations()[0]?.getModuleSpecifierSourceFile()?.getFilePath()).toBe(
      join(root, 'packages/ledger/src/index.ts'),
    );
  });
});

/**
 * A directory named like tests, which may hold code the application runs.
 *
 * Skipped by default and recorded with the files it held, so the skip is a row
 * rather than a silence; read when the service names it. The survey of what to
 * rebuild must list exactly what the project opens, either way.
 */
describe('a directory named like tests', () => {
  const tree = (): string =>
    workspace({
      'api/src/main.ts': 'export const main = 1;\n',
      'api/src/fixtures/catalogue.ts': 'export const catalogue = 1;\n',
      'api/src/e2e/client.ts': 'export const client = 1;\n',
      'api/src/orders.spec.ts': 'export const spec = 1;\n',
      'packages/stock/src/fixtures/seed.ts': 'export const seed = 1;\n',
    });

  /** The files a project opened, relative to the workspace. */
  const opened = (root: string, read?: readonly string[]): string[] => {
    const project = createProject({
      rootDir: join(root, 'api'),
      ...(read === undefined ? {} : { readTestDirectories: read }),
    });
    return project
      .getSourceFiles()
      .map((file) => file.getFilePath().slice(root.length + 1))
      .sort();
  };

  /** The survey's list, spelled the same way. */
  const listed = (root: string, read?: readonly string[]): string[] =>
    listRepoSources(join(root, 'api'), read)
      .map((file) => join('api', file).replace(/\\/g, '/'))
      .map((file) => file.replace(/^api\/\.\.\//, ''))
      .sort();

  it('skips it by default, and records it with the files it held', () => {
    const root = tree();
    const project = createProject({ rootDir: join(root, 'api') });
    const skipped = [...skippedTestDirectories(project)].map(([dir, files]) => [
      dir.slice(root.length + 1),
      files.map((file) => file.slice(root.length + 1)),
    ]);
    expect(skipped).toEqual([
      ['api/src/e2e', ['api/src/e2e/client.ts']],
      ['api/src/fixtures', ['api/src/fixtures/catalogue.ts']],
      ['packages/stock/src/fixtures', ['packages/stock/src/fixtures/seed.ts']],
    ]);
    expect(opened(root)).toEqual(['api/src/main.ts', 'packages/stock/src/index.ts', 'packages/stock/src/levels/format.ts']);
    expect(listed(root)).toEqual(opened(root));
  });

  it('reads one the service names, and does not record it', () => {
    const root = tree();
    const read = ['src/fixtures', '../packages/stock/src/fixtures'];
    expect(opened(root, read)).toEqual([
      'api/src/fixtures/catalogue.ts',
      'api/src/main.ts',
      'packages/stock/src/fixtures/seed.ts',
      'packages/stock/src/index.ts',
      'packages/stock/src/levels/format.ts',
    ]);
    const project = createProject({ rootDir: join(root, 'api'), readTestDirectories: read });
    expect([...skippedTestDirectories(project).keys()].map((dir) => dir.slice(root.length + 1))).toEqual([
      'api/src/e2e',
    ]);
    expect(listed(root, read)).toEqual(opened(root, read));
  });

  it('leaves a test by its name out without a record, whatever is named', () => {
    const root = tree();
    const project = createProject({ rootDir: join(root, 'api'), readTestDirectories: ['src'] });
    const files = project.getSourceFiles().map((file) => file.getBaseName());
    expect(files).not.toContain('orders.spec.ts');
    for (const held of skippedTestDirectories(project).values()) {
      expect(held.some((file) => file.endsWith('orders.spec.ts'))).toBe(false);
    }
  });
});

/**
 * Where a service's own code is (R170): the tsconfig's `include` and `files`,
 * `src` when it names nothing, and the directories a deployment packages from,
 * the same answer for the files opened and the files listed.
 */
describe('the source roots of a service', () => {
  const repository = (files: Record<string, string | object>): string => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-roots-')));
    temporary.push(root);
    write(root, {
      'src/holds.ts': 'export const holds = 1;\n',
      'functions/place-hold.ts': 'export const handler = 1;\n',
      'functions/shared/request.ts': 'export const request = 1;\n',
      'scripts/seed.ts': 'export const seed = 1;\n',
      ...files,
    });
    return root;
  };

  const opened = (root: string, options: { tsconfig?: string; deployed?: readonly string[] } = {}): string[] =>
    createProject({ rootDir: root, ...options })
      .getSourceFiles()
      .map((file) => file.getFilePath().slice(root.length + 1))
      .sort();

  it('falls back to src when the tsconfig names nothing, and to the whole repository without src', () => {
    const root = repository({ 'tsconfig.json': TSCONFIG });
    expect(sourceRootsOf(root)).toEqual(['src']);
    rmSync(join(root, 'src'), { recursive: true });
    expect(sourceRootsOf(root)).toEqual(['.']);
  });

  it('takes the directories the tsconfig includes, before any wildcard, and drops those not there', () => {
    const root = repository({
      'tsconfig.json': { ...TSCONFIG, include: ['src/**/*.ts', 'functions', 'lambdas/*/index.ts'] },
    });
    expect(sourceRootsOf(root)).toEqual(['functions', 'src']);
    expect(opened(root)).toEqual(['functions/place-hold.ts', 'functions/shared/request.ts', 'src/holds.ts']);
  });

  it('takes the directory of a file the tsconfig names, since the compiler follows imports from it', () => {
    const root = repository({ 'tsconfig.json': { ...TSCONFIG, files: ['functions/place-hold.ts'] } });
    expect(sourceRootsOf(root)).toEqual(['functions']);
  });

  it('follows a relative extends when the tsconfig itself names nothing', () => {
    const root = repository({
      'tsconfig.base.json': { ...TSCONFIG, include: ['functions'] },
      'tsconfig.json': { extends: './tsconfig.base.json' },
    });
    expect(sourceRootsOf(root)).toEqual(['functions']);
  });

  it('falls back on a solution tsconfig, whose files list is empty', () => {
    const root = repository({ 'tsconfig.json': { files: [], references: [{ path: './tsconfig.app.json' }] } });
    expect(sourceRootsOf(root)).toEqual(['src']);
  });

  it('keeps the outermost of nested roots, and the whole repository over everything', () => {
    const nested = repository({ 'tsconfig.json': { ...TSCONFIG, include: ['functions', 'functions/shared'] } });
    expect(sourceRootsOf(nested)).toEqual(['functions']);
    const whole = repository({ 'tsconfig.json': { ...TSCONFIG, include: ['**/*.ts', 'src'] } });
    expect(sourceRootsOf(whole)).toEqual(['.']);
  });

  it('never climbs out of the repository, nor into an output or hidden directory', () => {
    const root = repository({
      'tsconfig.json': { ...TSCONFIG, include: ['../elsewhere', 'dist/functions', '.next/types/**/*.ts', 'src'] },
      'dist/functions/place-hold.ts': 'export const built = 1;\n',
      '.next/types/app.ts': 'export const generated = 1;\n',
    });
    expect(sourceRootsOf(root)).toEqual(['src']);
  });

  it('adds the directories a deployment packages from beside src, for the reading and the listing alike', () => {
    const root = repository({ 'tsconfig.json': { ...TSCONFIG, include: ['src'] } });
    expect(sourceRootsOf(root, { deployed: ['functions'] })).toEqual(['functions', 'src']);
    expect(opened(root)).toEqual(['src/holds.ts']);
    const files = opened(root, { deployed: ['functions'] });
    expect(files).toEqual(['functions/place-hold.ts', 'functions/shared/request.ts', 'src/holds.ts']);
    expect(listRepoSources(root, undefined, { deployed: ['functions'] })).toEqual(files);
  });

  it('reads the whole repository when a reader asks for that as its fallback', () => {
    const root = repository({ 'tsconfig.json': TSCONFIG });
    expect(sourceRootsOf(root, { fallback: 'repository' })).toEqual(['.']);
  });

  it('leaves out a root named like a test, and records it', () => {
    const root = repository({
      'tsconfig.json': { ...TSCONFIG, include: ['src', 'e2e'] },
      'e2e/client.ts': 'export const client = 1;\n',
    });
    const project = createProject({ rootDir: root });
    expect(project.getSourceFiles().map((file) => file.getBaseName())).toEqual(['holds.ts']);
    expect([...skippedTestDirectories(project).keys()].map((dir) => dir.slice(root.length + 1))).toEqual(['e2e']);
    expect(listRepoSources(root)).toEqual(['src/holds.ts']);
  });

  /**
   * A service at the root of its own workspace: functions in `src/`, the client
   * they share in `packages/` (R175). The members it declares are read wherever
   * they sit, and a member its own roots already cover is listed once.
   */
  describe('of a service that is the root of a workspace', () => {
    const rooted = (files: Record<string, string | object> = {}): string =>
      repository({
        'package.json': { name: 'loans', workspaces: ['packages/*'], dependencies: { '@lib/workflows': 'workspace:*' } },
        'packages/workflows/package.json': { name: '@lib/workflows', main: './src/index.ts' },
        'packages/workflows/src/index.ts': 'export const start = 1;\n',
        'packages/tools/package.json': { name: '@lib/tools', main: './src/index.ts' },
        'packages/tools/src/index.ts': 'export const reindex = 1;\n',
        ...files,
      });

    it('reads a member it declares beside its own src, and not one it does not', () => {
      const root = rooted({ 'tsconfig.json': { ...TSCONFIG, include: ['src'] } });
      const files = ['packages/workflows/src/index.ts', 'src/holds.ts'];
      expect(opened(root)).toEqual(files);
      expect(listRepoSources(root)).toEqual(files);
    });

    it('lists a member once when the service is read whole', () => {
      const root = rooted({ 'tsconfig.json': { ...TSCONFIG, include: ['**/*.ts'] } });
      const files = listRepoSources(root);
      expect(files).toEqual([...new Set(files)]);
      expect(files).toContain('packages/workflows/src/index.ts');
      expect(opened(root)).toEqual(files);
    });
  });
});

