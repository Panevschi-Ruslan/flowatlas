import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Node } from 'ts-morph';
import { afterAll, describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { ConfigPath, NotLiteral, configValueAt, exportedNamesOf, readConfigLiteral } from './config-literal.js';
import {
  conventionFiles,
  implicitNamesUsed,
  implicitSourcesOf,
  reportConventions,
  scriptFilesIn,
  type ProjectConventions,
} from './conventions.js';
import { addEmbeddedScripts, type EmbeddedFormat } from './embedded.js';
import { causeOfTypeNode } from './follow-cause.js';
import { createProject, countSources } from './project.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A repository on disk, its files written as given. */
const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-conventions-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

/** The function a call in a file reaches through its import, by the call's text. */
const declarationCalled = (root: string, project: ReturnType<typeof createProject>, file: string, callee: string): string | undefined => {
  const source = project.getSourceFileOrThrow(join(root, file));
  for (const call of source.getDescendants().filter(Node.isCallExpression)) {
    if (call.getExpression().getText() !== callee) continue;
    const symbol = call.getExpression().getSymbol();
    const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
    return declaration?.getSourceFile().getFilePath().slice(root.length + 1);
  }
  return undefined;
};

/** A framework that aliases `~` to its `app/` and imports `composables/`' names unimported. */
const FRAMEWORK = (root: string, extra: Partial<ProjectConventions> = {}): ProjectConventions => ({
  by: 'Framework',
  adapter: 'framework-routes',
  file: 'framework.config.ts',
  generated: { tsconfigs: ['.framework/tsconfig.json'], command: 'framework prepare' },
  paths: { '~': ['app'], '~/*': ['app/*'] },
  implicit: [
    {
      label: 'the application',
      within: [''],
      except: ['server'],
      from: ['app/composables/'],
      sources: implicitSourcesOf(root, scriptFilesIn(root, 'app/composables'), (file) => (file.endsWith('useCart.ts') ? 'useCart' : undefined)),
    },
  ],
  modules: [{ specifier: '#imports', implicit: 0 }],
  frameworkModules: [{ name: '$app', package: 'framework-kit' }],
  files: ['framework.config.ts'],
  ...extra,
});

describe('a framework configuration read as literals (P240)', () => {
  it('reads the object a define call is handed, paths built from the file, and says what is code', () => {
    const root = repo({
      'framework.config.ts': [
        "import { fileURLToPath } from 'node:url';",
        "import { resolve } from 'node:path';",
        'export default defineConfig({',
        "  srcDir: 'app/',",
        "  alias: { '#a': fileURLToPath(new URL('./lib/a', import.meta.url)), '#b': resolve(__dirname, 'lib', 'b') },",
        '  dirs: process.env.DIRS,',
        '  future: { version: 4 },',
        '});',
      ].join('\n'),
    });
    const config = readConfigLiteral(root, ['framework.config.ts']);
    expect(configValueAt(config?.value, 'srcDir')).toBe('app/');
    expect(configValueAt(config?.value, 'future.version')).toBe(4);
    expect(configValueAt(config?.value, 'alias.#a')).toEqual(new ConfigPath(join(root, 'lib/a')));
    expect(configValueAt(config?.value, 'alias.#b')).toEqual(new ConfigPath(join(root, 'lib/b')));
    expect(configValueAt(config?.value, 'dirs')).toEqual(new NotLiteral('process.env.DIRS'));
  });

  it('follows `export default config` to its const, and a function of the mode to what it returns', () => {
    const named = repo({ 'a.config.js': "const config = { kit: { files: { lib: 'source/lib' } } };\nexport default config;\n" });
    expect(configValueAt(readConfigLiteral(named, ['a.config.js'])?.value, 'kit.files.lib')).toBe('source/lib');
    const mode = repo({ 'b.config.ts': "export default defineConfig(({ mode }) => ({ resolve: { alias: { '@': '/src' } } }));\n" });
    expect(configValueAt(readConfigLiteral(mode, ['b.config.ts'])?.value, 'resolve.alias.@')).toBe('/src');
  });

  it('names the values a module exports, and whether it has a default', () => {
    expect(exportedNamesOf('export const a = 1, { b } = x;\nexport function c() {}\nexport type T = 1;\nexport { d as e, f as default };\n', 'm.ts')).toEqual({
      named: ['a', 'b', 'c', 'e'],
      hasDefault: true,
    });
  });
});

describe('the names a file uses with no import (P240)', () => {
  const candidates = new Set(['useCart', 'format', 'shadowed']);

  it('is every use of a candidate the file does not declare at its top level', () => {
    const text = [
      "import { format } from './format';",
      'const cart = useCart();',
      'const shadowed = 1;',
      'const go = (useCart: number) => ({ useCart, total: cart.useCart });',
    ].join('\n');
    expect(implicitNamesUsed(text, 'page.ts', candidates)).toEqual(['useCart']);
  });

  it('is not a property name, a member or a key', () => {
    expect(implicitNamesUsed('const a = { useCart: 1 }; a.useCart; class B { useCart() {} }', 'page.ts', candidates)).toEqual([]);
  });

  it('includes a name only the markup uses', () => {
    expect(implicitNamesUsed('const a = 1;', 'page.part', candidates, ['format', 'other'])).toEqual(['format']);
  });
});

describe('a project opened with a framework conventions (P240)', () => {
  const files = {
    'tsconfig.json': JSON.stringify({ extends: './.framework/tsconfig.json', compilerOptions: { strict: false } }),
    'app/composables/useCart.ts': "export default function () { return { add: (id: string) => fetch('/api/cart/' + id) }; }\n",
    'app/composables/orders.ts': 'export const listOrders = () => fetch(\'/api/orders\');\n',
    'app/pages/index.ts': "import { listOrders as list } from '~/composables/orders';\nexport const page = () => { useCart(); list(); };\n",
    'app/pages/again.ts': "import { listOrders } from '#imports';\nexport const again = () => listOrders();\n",
    'server/api/orders.ts': 'export const handler = () => useCart();\n',
  };

  it('resolves the aliases its generated tsconfig would name, and says so once', () => {
    const root = repo(files);
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    expect(declarationCalled(root, project, 'app/pages/index.ts', 'list')).toBe('app/composables/orders.ts');
    const builder = new GraphBuilder({ repo: 'shop' });
    reportConventions({ project, builder });
    const rows = builder.build().unresolved.filter((row) => row.reason === 'aliases-from-convention');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.file).toBe('tsconfig.json');
    expect(rows[0]?.message).toBe('.framework/tsconfig.json is not there (`framework prepare` writes it), so ~ -> app resolve as Framework documents them');
  });

  it('adds the import a framework adds for a name used unimported, after every line of the file', () => {
    const root = repo(files);
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    expect(declarationCalled(root, project, 'app/pages/index.ts', 'useCart')).toBe('app/composables/useCart.ts');
    const page = project.getSourceFileOrThrow(join(root, 'app/pages/index.ts'));
    // The file's own lines are where they were.
    expect(page.getVariableDeclarationOrThrow('page').getStartLineNumber()).toBe(2);
    expect(page.getImportDeclarations().at(-1)?.getStartLineNumber()).toBe(4);
    // The server is a group of its own, and this one is not its.
    expect(declarationCalled(root, project, 'server/api/orders.ts', 'useCart')).toBeUndefined();
    const builder = new GraphBuilder({ repo: 'shop' });
    reportConventions({ project, builder });
    const row = builder.build().unresolved.find((each) => each.reason === 'implicit-imports-from-convention');
    expect(row?.message).toBe("1 name used with no import in 1 file were read as Framework imports them: the application's from app/composables/");
  });

  it('makes up the module of names a file imports by the framework name, and counts it as no file', () => {
    const root = repo(files);
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    expect(declarationCalled(root, project, 'app/pages/again.ts', 'listOrders')).toBe('app/composables/orders.ts');
    expect(countSources(project).files).toBe(5);
  });

  it('reads the generated tsconfig in place of the convention when it is there', () => {
    const root = repo({
      ...files,
      '.framework/tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '~/*': ['../app/composables/*'] } } }),
      'app/pages/index.ts': "import { listOrders } from '~/orders';\nexport const page = () => listOrders();\n",
    });
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    expect(declarationCalled(root, project, 'app/pages/index.ts', 'listOrders')).toBe('app/composables/orders.ts');
    const builder = new GraphBuilder({ repo: 'shop' });
    reportConventions({ project, builder });
    expect(builder.build().unresolved.map((row) => row.reason)).not.toContain('aliases-from-convention');
  });

  it('never replaces an alias the tsconfig names', () => {
    const root = repo({
      ...files,
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '~/*': ['./app/composables/*'] } } }),
      'app/pages/index.ts': "import { listOrders } from '~/orders';\nexport const page = () => listOrders();\n",
    });
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    expect(declarationCalled(root, project, 'app/pages/index.ts', 'listOrders')).toBe('app/composables/orders.ts');
  });

  it('joins no call to a name two files give, and says which', () => {
    const root = repo({
      ...files,
      'app/composables/again.ts': 'export const listOrders = () => 1;\n',
      'app/pages/index.ts': 'export const page = () => listOrders();\n',
    });
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    expect(declarationCalled(root, project, 'app/pages/index.ts', 'listOrders')).toBeUndefined();
    const builder = new GraphBuilder({ repo: 'shop' });
    reportConventions({ project, builder });
    const row = builder.build().unresolved.find((each) => each.reason === 'implicit-import-ambiguous');
    expect(row).toMatchObject({ file: 'app/pages/index.ts', line: 1, symbol: 'listOrders' });
  });

  it('imports a name for a component file only its markup uses', () => {
    const root = repo({ ...files, 'app/pages/cart.part': 'markup(useCart) <<const a = 1;>>' });
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    const format: EmbeddedFormat = {
      extension: '.part',
      scripts: (text) => ({ ranges: [[text.indexOf('<<') + 2, text.indexOf('>>')]], uses: ['useCart'] }),
    };
    const [made] = addEmbeddedScripts(project, root, ['app/pages/cart.part'], [format]);
    expect(made?.sourceFile.getImportDeclarations().map((each) => each.getModuleSpecifierSourceFile()?.getBaseName())).toEqual(['useCart.ts']);
  });

  it('names the framework, not a package of the module name, for a module no file is', () => {
    const root = repo({ ...files, 'app/pages/nav.ts': "import { goto } from '$app/navigation';\nexport const nav: goto = 1;\n" });
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    const typed = project.getSourceFileOrThrow(join(root, 'app/pages/nav.ts')).getVariableDeclarationOrThrow('nav').getTypeNodeOrThrow();
    expect(causeOfTypeNode(typed)).toEqual({ cause: 'module-not-installed', package: 'framework-kit' });
  });

  it('lists the files the conventions were read from, for a rebuild to notice', () => {
    const root = repo(files);
    const project = createProject({ rootDir: root, conventions: [FRAMEWORK(root)] });
    expect(conventionFiles(project)).toEqual(['app/composables/orders.ts', 'app/composables/useCart.ts', 'framework.config.ts']);
  });
});

describe('the projects a solution tsconfig refers to (P240)', () => {
  it('lends their aliases, and says so', () => {
    const root = repo({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
      'tsconfig.app.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } }, include: ['src'] }),
      'src/api.ts': 'export const load = () => 1;\n',
      'src/page.ts': "import { load } from '@/api';\nexport const page = () => load();\n",
    });
    const project = createProject({ rootDir: root });
    expect(declarationCalled(root, project, 'src/page.ts', 'load')).toBe('src/api.ts');
    const builder = new GraphBuilder({ repo: 'web' });
    reportConventions({ project, builder });
    expect(builder.build().unresolved[0]).toMatchObject({
      reason: 'aliases-from-config',
      file: 'tsconfig.json',
      message: '@/* -> src/* resolve as tsconfig.app.json says, and the tsconfig read names none of them',
    });
  });
});
