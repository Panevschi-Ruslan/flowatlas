import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from './project.js';

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
