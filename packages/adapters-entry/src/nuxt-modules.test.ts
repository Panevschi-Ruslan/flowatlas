import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nuxtApplicationOf } from './framework-conventions.js';
import { modulesReadRow } from './nuxt-modules.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-modules-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

const NUXT_4 = { dependencies: { nuxt: '^4.1.0' } };

const module = (body: string, head = "import { createResolver, defineNuxtModule } from '@nuxt/kit';"): string =>
  `${head}\nexport default defineNuxtModule({\n  setup(_options, nuxt) {\n${body}\n  },\n});\n`;

describe('which modules of the repository a Nuxt application is built with (P251)', () => {
  it("reads each file of `modules/` and each folder's `index`, a listed path once, and a workspace package at its source", () => {
    const root = repo({
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['app', 'audit'] }),
      'app/package.json': JSON.stringify({ name: 'app', ...NUXT_4 }),
      'app/nuxt.config.ts': "export default defineNuxtConfig({ modules: ['./modules/b', 'audit', './tools/c.ts'] });",
      'app/modules/a.ts': module(''),
      'app/modules/b/index.ts': module(''),
      'app/modules/notes.md': '',
      'app/tools/c.ts': module(''),
      'audit/package.json': JSON.stringify({ name: 'audit', exports: { '.': { import: './dist/module.mjs' } } }),
      'audit/src/module.ts': module(''),
    });
    const { modules } = nuxtApplicationOf(join(root, 'app'), NUXT_4);
    expect(modules.modules.map((each) => [each.file, each.name])).toEqual([
      ['modules/b/index.ts', './modules/b'],
      ['../audit/src/module.ts', 'audit'],
      ['tools/c.ts', './tools/c.ts'],
      ['modules/a.ts', 'modules/a.ts'],
    ]);
    expect(modules.rows).toEqual([]);
  });

  it('reads a workspace module whose manifest names only its build from the source it was built from (P255)', () => {
    const root = repo({
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['app', 'sibling', 'mapped', 'sourced', 'built'] }),
      'app/package.json': JSON.stringify({ name: 'app', ...NUXT_4 }),
      'app/nuxt.config.ts': "export default defineNuxtConfig({ modules: ['sibling', 'mapped', 'sourced', 'built'] });",
      // `dist/kit.mjs` in place of `src/kit.ts`.
      'sibling/package.json': JSON.stringify({ name: 'sibling', exports: { '.': { types: './dist/kit.d.mts', import: './dist/kit.mjs' } } }),
      'sibling/src/kit.ts': module(''),
      // The build's source map names its source.
      'mapped/package.json': JSON.stringify({ name: 'mapped', main: './dist/index.js' }),
      'mapped/dist/index.js': 'export default {};\n//# sourceMappingURL=index.js.map\n',
      'mapped/dist/index.js.map': JSON.stringify({ version: 3, sources: ['../lib/entry.ts'], mappings: '' }),
      'mapped/lib/entry.ts': module(''),
      // A `source` condition.
      'sourced/package.json': JSON.stringify({ name: 'sourced', exports: { '.': { source: './lib/main.ts', import: './dist/main.mjs' } } }),
      'sourced/lib/main.ts': module(''),
      // Only a build, and no source anywhere: not read.
      'built/package.json': JSON.stringify({ name: 'built', exports: { '.': { import: './dist/module.mjs' } } }),
    });
    const { modules } = nuxtApplicationOf(join(root, 'app'), NUXT_4);
    expect(modules.modules.map((each) => each.file)).toEqual(['../sibling/src/kit.ts', '../mapped/lib/entry.ts', '../sourced/lib/main.ts']);
    expect(modules.rows.map((row) => [row.symbol, row.meta?.why])).toEqual([['built', 'missing']]);
  });

  it('reads the modules of `dir.modules`, and a layer\'s listed module from the layer', () => {
    const root = repo({
      'nuxt.config.ts': "export default defineNuxtConfig({ dir: { modules: 'kit' }, extends: ['./base'] });",
      'kit/one.ts': module(''),
      'modules/ignored.ts': module(''),
      'base/nuxt.config.ts': "export default defineNuxtConfig({ modules: ['./extra'] });",
      'base/extra.ts': module(''),
    });
    const { modules } = nuxtApplicationOf(root, NUXT_4);
    expect(modules.modules.map((each) => [each.file, each.rank])).toEqual([
      ['kit/one.ts', 0],
      ['base/extra.ts', 1],
    ]);
  });

  it('names a package from a registry, a known one with what it adds, and says a module written as code, in place or missing', () => {
    const root = repo({
      'nuxt.config.ts':
        "export default defineNuxtConfig({ modules: ['@vueuse/nuxt', '@nuxtjs/i18n', '@pinia/nuxt', process.env.X, defineNuxtModule({ setup() {} }), './nope'] });",
    });
    const { modules } = nuxtApplicationOf(root, NUXT_4);
    expect(modules.installed.map((each) => [each.name, each.why, each.adds !== undefined])).toEqual([
      ['@vueuse/nuxt', 'not-installed', true],
      ['@nuxtjs/i18n', 'not-installed', false],
    ]);
    expect(modules.rows.map((row) => [row.reason, row.meta?.why])).toEqual([
      ['framework-module-unread', 'dynamic'],
      ['framework-module-unread', 'inline'],
      ['framework-module-unread', 'missing'],
    ]);
  });
});

describe('what a module adds (P251)', () => {
  it('reads import directories, names, routes, middleware, pages and aliases from paths built from its file', () => {
    const root = repo({
      'modules/shop/index.ts': module(
        [
          "    const resolver = createResolver(import.meta.url);",
          "    const { resolve: from } = createResolver(import.meta.url);",
          "    const runtime = resolver.resolve('./runtime');",
          "    addImportsDir([resolver.resolve('./runtime/composables'), `${runtime}/utils/**`]);",
          "    addServerImportsDir(from('./runtime/server/utils'));",
          "    addImports({ name: 'default', as: 'useCart', from: from('./runtime/cart') });",
          "    addImports([{ name: 'ref', from: 'vue' }]);",
          "    addServerHandler({ route: '/api/cart/:id', method: 'delete', handler: resolver.resolve('./runtime/server/drop') });",
          "    addServerHandler({ handler: resolver.resolve('./runtime/server/log') });",
          "    extendPages((pages) => { pages.push({ name: 'cart', path: '/cart', file: resolver.resolve('./runtime/cart.vue') }); });",
          "    nuxt.hook('pages:extend', (list) => { list.unshift({ path: '/basket', file: resolver.resolve('./runtime/cart.vue') }); });",
          "    nuxt.options.alias['#cart'] = runtime;",
          "    nuxt.options.alias.basket ||= resolver.resolve('./runtime');",
          "    addPlugin(resolver.resolve('./runtime/plugin'));",
        ].join('\n'),
      ),
      'modules/shop/runtime/composables/useTotal.ts': 'export const useTotal = () => 0;',
      'modules/shop/runtime/server/utils/db.ts': 'export const db = {};',
      'modules/shop/runtime/cart.ts': 'export default () => ({});',
      'modules/shop/runtime/server/drop.ts': 'export default defineEventHandler(() => null);',
      'modules/shop/runtime/server/log.ts': 'export default defineEventHandler(() => undefined);',
      'modules/shop/runtime/cart.vue': '<template><p /></template>',
      'modules/shop/runtime/plugin.ts': 'export default defineNuxtPlugin(() => {});',
    });
    const [read] = nuxtApplicationOf(root, NUXT_4).modules.modules;
    expect(read?.additions).toMatchObject({
      importDirs: [
        { dir: 'modules/shop/runtime/composables', nested: false },
        { dir: 'modules/shop/runtime/utils', nested: true },
      ],
      serverImportDirs: [{ dir: 'modules/shop/runtime/server/utils', nested: false }],
      imports: [{ file: 'modules/shop/runtime/cart.ts', name: 'useCart', export: 'default' }],
      handlers: [
        { route: '/api/cart/:id', method: 'DELETE', handler: 'modules/shop/runtime/server/drop.ts', file: 'modules/shop/index.ts', line: 11, middleware: false },
        { method: 'ALL', handler: 'modules/shop/runtime/server/log.ts', middleware: true },
      ],
      pages: [
        { path: '/cart', file: 'modules/shop/runtime/cart.vue' },
        { path: '/basket', file: 'modules/shop/runtime/cart.vue' },
      ],
      aliases: [
        { key: '#cart', target: 'modules/shop/runtime', replaces: true },
        { key: 'basket', target: 'modules/shop/runtime', replaces: false },
      ],
      plugins: [{ file: 'modules/shop/runtime/plugin.ts', line: 17 }],
      notRead: [],
    });
  });

  it('reads an addition written under a condition the options do not decide as made, and says which', () => {
    const root = repo({
      'nuxt.config.ts': "export default defineNuxtConfig({ modules: [['./modules/maybe', someOptions]] });",
      'modules/maybe.ts': module(
        [
          '    const resolver = createResolver(import.meta.url);',
          "    if (_options.server) addServerHandler({ route: '/api/x', handler: resolver.resolve('./x') });",
          "    _options.names && addImportsDir(resolver.resolve('./names'));",
          "    addImportsDir(resolver.resolve('./always'));",
        ].join('\n'),
      ),
      'modules/x.ts': 'export default defineEventHandler(() => 1);',
    });
    const { modules } = nuxtApplicationOf(root, NUXT_4).modules;
    const maybe = modules.find((each) => each.file === 'modules/maybe.ts');
    expect(maybe?.additions.conditional).toEqual(['addServerHandler (line 5)', 'addImportsDir (line 6)']);
    expect(maybe?.additions.handlers.map((handler) => handler.route)).toEqual(['/api/x']);
    expect(modulesReadRow(nuxtApplicationOf(root, NUXT_4).layers[0]!.layout, [maybe!]).message).toContain(
      'addServerHandler (line 5) and addImportsDir (line 6) are written under a condition and read as made',
    );
  });

  it('decides a condition by the options the configuration hands the module, its `configKey` and its defaults (P255)', () => {
    const optioned = (body: string): string =>
      `import { createResolver, defineNuxtModule } from '@nuxt/kit';\nexport default defineNuxtModule({\n  meta: { configKey: 'shop' },\n  defaults: { server: true, mode: 'full' },\n  setup(options) {\n    const resolver = createResolver(import.meta.url);\n${body}\n  },\n});\n`;
    const root = repo({
      'nuxt.config.ts': "export default defineNuxtConfig({ modules: [['./modules/inline', { server: false }], './modules/keyed', './modules/early'], shop: { mode: 'lite' } });",
      'modules/inline.ts': optioned("    if (options.server) addServerHandler({ route: '/api/inline', handler: resolver.resolve('./x') });"),
      'modules/keyed.ts': optioned(
        [
          "    if (options.mode === 'lite') addImportsDir(resolver.resolve('./lite'));",
          "    else addImportsDir(resolver.resolve('./full'));",
          "    options.server && addServerHandler({ route: '/api/keyed', handler: resolver.resolve('./x') });",
        ].join('\n'),
      ),
      'modules/early.ts': optioned(["    if (options.mode !== 'full' && options.server) return;", "    addImportsDir(resolver.resolve('./late'));"].join('\n')),
      'modules/x.ts': 'export default defineEventHandler(() => 1);',
    });
    const { modules, rows } = nuxtApplicationOf(root, NUXT_4).modules;
    const of = (file: string) => modules.find((each) => each.file === file)?.additions;
    // Each call ruled out is a note at the call too.
    expect(rows.map((row) => [row.reason, row.file, row.line])).toEqual([
      ['framework-module-skipped', 'modules/inline.ts', 7],
      // The `else` the `lite` mode does not take.
      ['framework-module-skipped', 'modules/keyed.ts', 8],
      ['framework-module-skipped', 'modules/early.ts', 8],
    ]);
    // `server: false` handed in place wins over the default.
    expect(of('modules/inline.ts')).toMatchObject({ handlers: [], skipped: ['addServerHandler (line 7, under `options.server`)'], conditional: [] });
    // `mode` from the configuration's `shop`, `server` from the defaults: every condition decided.
    expect(of('modules/keyed.ts')?.importDirs.map((dir) => dir.dir)).toEqual(['modules/lite']);
    expect(of('modules/keyed.ts')?.handlers.map((handler) => handler.route)).toEqual(['/api/keyed']);
    expect(of('modules/keyed.ts')?.conditional).toEqual([]);
    // An early `return` the options take: nothing after it is added.
    expect(of('modules/early.ts')).toMatchObject({ importDirs: [], skipped: ["addImportsDir (line 8, under `options.mode !== 'full' && options.server`)"] });
  });

  it('reads the components, route middleware and server directories a module adds (P255)', () => {
    const root = repo({
      'modules/kit.ts': module(
        [
          '    const resolver = createResolver(import.meta.url);',
          "    addComponentsDir({ path: resolver.resolve('./ui'), prefix: 'Kit', pathPrefix: false });",
          "    addComponent({ name: 'KitChart', filePath: resolver.resolve('./chart.vue') });",
          "    addRouteMiddleware({ name: 'kit-guard', path: resolver.resolve('./guard'), global: true }, { override: true });",
          "    addRouteMiddleware({ name: 'lost', path: someVariable });",
          "    addServerScanDir(resolver.resolve('./server'));",
        ].join('\n'),
      ),
      'modules/chart.vue': '<template><svg /></template>',
      'modules/guard.ts': 'export default defineNuxtRouteMiddleware(() => undefined);',
    });
    const { modules, rows } = nuxtApplicationOf(root, NUXT_4).modules;
    expect(modules.find((each) => each.file === 'modules/kit.ts')?.additions).toMatchObject({
      componentDirs: [{ dir: 'modules/ui', prefix: 'Kit', pathPrefix: false }],
      components: [{ name: 'KitChart', file: 'modules/chart.vue' }],
      routeMiddleware: [{ name: 'kit-guard', file: 'modules/guard.ts', global: true, override: true }],
      serverScanDirs: ['modules/server'],
      notRead: [],
    });
    expect(rows.map((row) => [row.symbol, row.meta?.why])).toEqual([['addRouteMiddleware', 'addition']]);
  });

  it('reads `resolve(__dirname, ...)`, `fileURLToPath(new URL(...))` and an installed module, and says a relative string and a variable', () => {
    const root = repo({
      'modules/a.ts': module(
        [
          "    addImportsDir(resolve(__dirname, 'a-names'));",
          "    addImportsDir(fileURLToPath(new URL('./a-more', import.meta.url)));",
          "    addImportsDir('./relative');",
          "    addServerHandler({ route: someRoute, handler: resolve(__dirname, '../handlers/h') });",
          "    installModule(resolve(__dirname, 'b'));",
        ].join('\n'),
        "import { resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';",
      ),
      'modules/b.ts': module("    addImportsDir(resolve(__dirname, 'b-names'));", "import { resolve } from 'node:path';"),
      'handlers/h.ts': 'export default defineEventHandler(() => 1);',
    });
    const { modules, rows } = nuxtApplicationOf(root, NUXT_4).modules;
    expect(modules.map((each) => [each.file, each.additions.importDirs.map((dir) => dir.dir)])).toEqual([
      ['modules/a.ts', ['modules/a-names', 'modules/a-more']],
      ['modules/b.ts', ['modules/b-names']],
    ]);
    expect(rows.map((row) => [row.reason, row.symbol, row.line, row.meta?.why])).toEqual([
      ['framework-module-unread', 'addImportsDir', 7, 'addition'],
      ['framework-module-unread', 'addServerHandler', 8, 'addition'],
    ]);
  });
});

describe("a module's conditions on the build that is read (P258)", () => {
  it('decides `nuxt.options.dev` and `nuxt.options._prepare` false, as production builds, and says a branch only development takes', () => {
    const root = repo({
      'modules/dev.ts': module(
        [
          '    const resolver = createResolver(import.meta.url);',
          "    if (nuxt.options.dev) addServerHandler({ route: '/api/debug', handler: resolver.resolve('./h') });",
          "    if (!nuxt.options.dev) addImportsDir(resolver.resolve('./always'));",
          "    nuxt.options._prepare || addImportsDir(resolver.resolve('./built'));",
          '    if (!nuxt.options.dev) return;',
          "    addImportsDir(resolver.resolve('./dev-only'));",
        ].join('\n'),
      ),
      'modules/h.ts': 'export default defineEventHandler(() => 1);',
    });
    const { modules, rows } = nuxtApplicationOf(root, NUXT_4).modules;
    const [read] = modules;
    expect(read?.additions.handlers).toEqual([]);
    expect(read?.additions.importDirs.map((dir) => dir.dir)).toEqual(['modules/always', 'modules/built']);
    expect(read?.additions.conditional).toEqual([]);
    expect(rows.filter((row) => row.reason === 'framework-module-skipped').map((row) => [row.symbol, row.line, row.meta?.why])).toEqual([
      ['addServerHandler', 5, 'development'],
      ['addImportsDir', 9, 'development'],
    ]);
  });

  it('reads the plugins a module adds, of the application and of the server', () => {
    const root = repo({
      'modules/p.ts': module(
        [
          '    const resolver = createResolver(import.meta.url);',
          "    addPlugin({ src: resolver.resolve('./runtime/client'), mode: 'client' });",
          "    addServerPlugin(resolver.resolve('./runtime/nitro'));",
          '    addPlugin(somewhere);',
        ].join('\n'),
      ),
      'modules/runtime/client.ts': 'export default defineNuxtPlugin(() => {});',
      'modules/runtime/nitro.ts': 'export default defineNitroPlugin(() => {});',
    });
    const { modules, rows } = nuxtApplicationOf(root, NUXT_4).modules;
    expect(modules[0]?.additions.plugins).toEqual([{ file: 'modules/runtime/client.ts', line: 5 }]);
    expect(modules[0]?.additions.serverPlugins).toEqual([{ file: 'modules/runtime/nitro.ts', line: 6 }]);
    expect(rows.map((row) => [row.reason, row.symbol])).toEqual([['framework-module-unread', 'addPlugin']]);
  });
});
