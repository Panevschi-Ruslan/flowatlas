import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { toPosixPath } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { keptByLayer, nuxtConventions, nuxtLayersOf, nuxtLayoutOf, sveltekitConventions, sveltekitRoutesOf } from './framework-conventions.js';
import { nitroAddressOf, nuxtPagesOf, sveltekitPagesOf } from './nuxt-routes.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-framework-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

const NUXT_3 = { dependencies: { nuxt: '^3.13.0' } };
const NUXT_4 = { dependencies: { nuxt: '^4.1.0' } };

describe("where a Nuxt application's code is (P240)", () => {
  it('is the root before version 4, with the server inside it', () => {
    const root = repo({ 'pages/index.vue': '', 'app/README.md': '' });
    expect(nuxtLayoutOf(root, NUXT_3)).toMatchObject({ srcDir: '', serverDir: 'server', version: 3 });
  });

  it('is `app/` from version 4, or with the compatibility version, and the server beside it', () => {
    const root = repo({ 'app/pages/index.vue': '' });
    expect(nuxtLayoutOf(root, NUXT_4)).toMatchObject({ srcDir: 'app', serverDir: 'server', version: 4 });
    const flagged = repo({ 'app/pages/index.vue': '', 'nuxt.config.ts': 'export default defineNuxtConfig({ future: { compatibilityVersion: 4 } });' });
    expect(nuxtLayoutOf(flagged, NUXT_3)).toMatchObject({ srcDir: 'app', version: 4 });
  });

  it('is the root on version 4 without an `app/`', () => {
    expect(nuxtLayoutOf(repo({ 'pages/index.vue': '' }), NUXT_4).srcDir).toBe('');
  });

  it('is what `srcDir` says, and the server moves with it before version 4', () => {
    const root = repo({ 'nuxt.config.ts': "export default defineNuxtConfig({ srcDir: 'src/' });" });
    expect(nuxtLayoutOf(root, NUXT_3)).toMatchObject({ srcDir: 'src', serverDir: 'src/server' });
  });

  it('is the default, and a row, where `srcDir` is code', () => {
    const root = repo({ 'nuxt.config.ts': 'export default defineNuxtConfig({ srcDir: process.env.SRC });' });
    const layout = nuxtLayoutOf(root, NUXT_3);
    expect(layout.srcDir).toBe('');
    expect(layout.rows.map((row) => [row.reason, row.symbol])).toEqual([['framework-setting-dynamic', 'srcDir']]);
  });
});

describe("Nuxt's conventions (P240)", () => {
  it('aliases `~` and `@` to the application, `~~` and `@@` to the root, and a written alias where it says', () => {
    const root = repo({
      'app/pages/index.vue': '',
      'app/catalog/products.ts': '',
      'nuxt.config.ts': "export default defineNuxtConfig({ alias: { '#catalog': '~/catalog', '#root-file': '~~/x.ts' } });",
      'x.ts': '',
    });
    const paths = nuxtConventions(root, NUXT_4)?.paths ?? {};
    expect(paths).toMatchObject({ '~': ['app'], '~/*': ['app/*'], '@@': ['.'], '#catalog': ['app/catalog'], '#catalog/*': ['app/catalog/*'], '#root-file': ['x.ts'] });
    expect(paths['#root-file/*']).toBeUndefined();
  });

  it('imports for the application what `composables/`, `utils/`, `stores/` and `imports.dirs` export, and for the server `server/utils/`', () => {
    const root = repo({
      'nuxt.config.ts': "export default defineNuxtConfig({ modules: ['@pinia/nuxt'], imports: { dirs: ['queries/**'] } });",
      'composables/useCart.ts': 'export default () => 1;',
      'composables/nested/index.ts': 'export const fromIndex = 1;',
      'composables/deep/inner.ts': 'export const notScanned = 1;',
      'utils/use-money.ts': 'export default () => 1;\nexport const cents = 1;',
      'stores/orders.ts': 'export const useOrdersStore = 1;',
      'queries/deep/search.ts': 'export const search = 1;',
      'server/utils/db.ts': 'export const query = 1;',
    });
    const [app, server] = nuxtConventions(root, NUXT_3)?.implicit ?? [];
    const names = (group: typeof app) => group?.sources.flatMap((source) => source.names.map((each) => `${each.name}<-${source.file}`)).sort();
    expect(names(app)).toEqual([
      'cents<-utils/use-money.ts',
      'fromIndex<-composables/nested/index.ts',
      'search<-queries/deep/search.ts',
      'useCart<-composables/useCart.ts',
      'useMoney<-utils/use-money.ts',
      'useOrdersStore<-stores/orders.ts',
    ]);
    expect(app?.except).toContain('server');
    expect(names(server)).toEqual(['query<-server/utils/db.ts']);
    expect(server?.within).toEqual(['server']);
  });

  it('imports nothing unimported where `imports.autoImport` is off', () => {
    const root = repo({ 'nuxt.config.ts': 'export default defineNuxtConfig({ imports: { autoImport: false } });', 'composables/a.ts': 'export const a = 1;' });
    expect(nuxtConventions(root, NUXT_3)?.implicit).toEqual([]);
  });

  it('shares `shared/utils` with both halves from version 4', () => {
    const root = repo({ 'app/pages/index.vue': '', 'shared/utils/slug.ts': 'export const slugify = 1;' });
    const groups = nuxtConventions(root, NUXT_4)?.implicit ?? [];
    expect(groups.map((group) => group.sources.map((source) => source.file))).toEqual([['shared/utils/slug.ts'], ['shared/utils/slug.ts']]);
  });

  it('says each layer it does not read, and reads the one under `layers/` (P243)', () => {
    const root = repo({ 'nuxt.config.ts': "export default defineNuxtConfig({ extends: ['github:example/base', ['./theme', { install: true }]] });", 'layers/admin/nuxt.config.ts': '' });
    const rows = nuxtConventions(root, NUXT_3)?.rows ?? [];
    expect(rows.filter((row) => row.reason === 'framework-layer-unread').map((row) => [row.symbol, row.meta?.['why']])).toEqual([
      ['github:example/base', 'remote'],
      ['./theme', 'missing'],
    ]);
    expect(rows.find((row) => row.reason === 'framework-layer-read')?.meta?.['layers']).toEqual(['layers/admin']);
  });

  it('states nothing for a repository that does not declare Nuxt', () => {
    expect(nuxtConventions(repo({}), { dependencies: { h3: '^1.0.0' } })).toBeUndefined();
  });
});

describe("a Nuxt application's layers (P243)", () => {
  /** An application at `shop/` of a repository, its `.git` at the top, with whatever else is beside it. */
  const checkout = (files: Record<string, string>): string => join(repo({ '.git/HEAD': '', ...files }), 'shop');

  it('ranks the application, `layers/` from Z to A, then each `extends` entry followed by what it extends, and reads each once', () => {
    const shop = checkout({
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui', './layers/a', '../theme'] });",
      'shop/layers/a/nuxt.config.ts': '',
      'shop/layers/b/nuxt.config.ts': '',
      'ui/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../tokens'] });",
      // A cycle back to the layer that extends it.
      'tokens/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui'] });",
      'theme/nuxt.config.ts': '',
    });
    const { layers, rows } = nuxtLayersOf(shop, NUXT_3);
    expect(layers.map((layer) => [layer.at, layer.extendedBy])).toEqual([
      ['', undefined],
      ['layers/b', undefined],
      ['layers/a', undefined],
      ['../ui', undefined],
      ['../tokens', '../ui'],
      ['../theme', undefined],
    ]);
    expect(rows).toEqual([]);
  });

  it('reads each layer under the application version, its own `app/` and server beside it from version 4', () => {
    const shop = checkout({
      'shop/app/pages/index.vue': '',
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui', '../plain'] });",
      'ui/app/pages/index.vue': '',
      'plain/pages/index.vue': '',
    });
    const [, ui, plain] = nuxtLayersOf(shop, NUXT_4).layers;
    expect(ui?.layout).toMatchObject({ srcDir: '../ui/app', serverDir: '../ui/server', version: 4 });
    expect(plain?.layout).toMatchObject({ srcDir: '../plain', serverDir: '../plain/server' });
  });

  it('reads a layer named as a package of the workspace, and says one installed from a registry, one not installed, one in code and one outside', () => {
    const outside = repo({ 'nuxt.config.ts': '' });
    const shop = checkout({
      'package.json': JSON.stringify({ private: true, workspaces: ['shop', 'brand'] }),
      'shop/package.json': JSON.stringify({ name: 'shop', dependencies: { nuxt: '^3.13.0' } }),
      'shop/nuxt.config.ts': `export default defineNuxtConfig({ extends: [['brand', { meta: {} }], 'registry-layer', 'missing-layer', ${JSON.stringify(outside)}, 'gh:example/x'] });`,
      'brand/package.json': JSON.stringify({ name: 'brand' }),
      'brand/nuxt.config.ts': '',
      'shop/node_modules/registry-layer/package.json': JSON.stringify({ name: 'registry-layer' }),
    });
    const { layers, rows } = nuxtLayersOf(shop, NUXT_3);
    expect(layers.map((layer) => [layer.at, layer.name])).toEqual([
      ['', 'the application'],
      ['../brand', 'brand'],
    ]);
    expect(rows.map((row) => [row.symbol, row.meta?.['why']])).toEqual([
      ['registry-layer', 'installed'],
      ['missing-layer', 'not-installed'],
      [outside, 'outside'],
      ['gh:example/x', 'remote'],
    ]);
    const dynamic = checkout({ 'shop/nuxt.config.ts': 'export default defineNuxtConfig({ extends: layersFromEnv() });' });
    expect(nuxtLayersOf(dynamic, NUXT_3).rows.map((row) => [row.reason, row.meta?.['why']])).toEqual([['framework-layer-unread', 'dynamic']]);
  });

  it("imports every layer's names, the higher layer's ranked first, and serves a layer's server too", () => {
    const shop = checkout({
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui'] });",
      'shop/composables/useCart.ts': 'export const useCart = 1;',
      'shop/layers/base/composables/useCart.ts': 'export const useCart = 2;',
      'shop/layers/base/server/utils/db.ts': 'export const query = 1;',
      'ui/utils/money.ts': 'export const formatMoney = 1;',
      'ui/server/utils/db.ts': 'export const query = 2;',
    });
    const conventions = nuxtConventions(shop, NUXT_3);
    const [app, server] = conventions?.implicit ?? [];
    const ranked = (group: typeof app) => group?.sources.map((source) => `${source.file}@${source.rank ?? 0}`);
    expect(ranked(app)).toEqual(['composables/useCart.ts@0', 'layers/base/composables/useCart.ts@1', '../ui/utils/money.ts@2']);
    expect(ranked(server)).toEqual(['layers/base/server/utils/db.ts@1', '../ui/server/utils/db.ts@2']);
    expect(app?.except).toEqual(expect.arrayContaining(['server', 'layers/base/server', '../ui/server']));
    expect(server?.within).toEqual(['server', 'layers/base/server', '../ui/server']);
    // The layer beside the application is part of it; its files are stamped.
    expect(conventions?.extent?.map(toPosixPath)).toEqual([toPosixPath(join(dirname(shop), 'ui'))]);
    expect(conventions?.files).toEqual(['nuxt.config.ts', '../ui/server/utils/db.ts', '../ui/utils/money.ts']);
    expect(conventions?.precedence).toBe("the order of Nuxt's layers: the application, layers/base and ../ui");
  });

  it("aliases a directory of `layers/` by its name, and adds a layer's own aliases under the application's", () => {
    const shop = checkout({
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui'], alias: { '#ui': '~/ui' } });",
      'shop/layers/base/nuxt.config.ts': '',
      'ui/nuxt.config.ts': "import { fileURLToPath } from 'node:url';\nexport default defineNuxtConfig({ alias: { '#ui': fileURLToPath(new URL('./x', import.meta.url)), '#tokens': fileURLToPath(new URL('./tokens', import.meta.url)) } });",
    });
    const paths = nuxtConventions(shop, NUXT_3)?.paths ?? {};
    expect(paths).toMatchObject({ '#layers/base': ['layers/base'], '#layers/base/*': ['layers/base/*'], '#ui': ['ui'], '#tokens': ['../ui/tokens'] });
  });

  it("says an import a layer writes with `~` that names the layer's own code, which Nuxt resolves in the application", () => {
    const shop = checkout({
      'shop/composables/known.ts': '',
      'shop/layers/base/utils/limits.ts': 'export const LIMIT = 1;',
      'shop/layers/base/utils/known.ts': '',
      'shop/layers/base/components/Badge.vue': "<script setup lang=\"ts\">\nimport { LIMIT } from '~/utils/limits';\nimport { known } from '~/composables/known';\n</script>\n",
    });
    const rows = (nuxtConventions(shop, NUXT_3)?.rows ?? []).filter((row) => row.reason === 'framework-layer-alias');
    expect(rows.map((row) => [row.file, row.line, row.symbol, row.hint])).toEqual([
      ['layers/base/components/Badge.vue', 2, '~/utils/limits', 'Import it with a relative path or through `#layers/base/utils/limits`.'],
    ]);
  });

  it("shows a page at an address two parts give from the higher part's file, and says the other", () => {
    const shop = checkout({
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui'] });",
      'ui/nuxt.config.ts': '',
    });
    const { routes, rows } = nuxtPagesOf(shop, NUXT_3, ['pages/index.vue', '../ui/pages/index.vue', '../ui/pages/catalog/[id].vue']);
    expect([...routes]).toEqual([
      ['pages/index.vue', '/'],
      ['../ui/pages/catalog/[id].vue', '/catalog/:param'],
    ]);
    expect(rows.map((row) => [row.reason, row.file, row.symbol, row.meta?.['chosen']])).toEqual([['framework-layer-overridden', '../ui/pages/index.vue', '/', 'pages/index.vue']]);
  });

  it('keeps every claim of the best-ranked part, and of a lower part only what no higher one claims', () => {
    const claim = (key: string, file: string, rank: number) => ({ key, label: key, file, layer: undefined, rank });
    const { kept, rows } = keptByLayer([claim('GET:/a', 'x/a.ts', 2), claim('GET:/a', 'y/a.ts', 1), claim('GET:/a', 'y/a2.ts', 1), claim('GET:/b', 'x/b.ts', 2)], 'serves');
    expect(kept.map((each) => each.file)).toEqual(['y/a.ts', 'y/a2.ts', 'x/b.ts']);
    expect(rows.map((row) => row.file)).toEqual(['x/a.ts']);
  });
});

describe('Nitro routes under a server directory of their own (P240)', () => {
  it('reads the address under the directory the layout names', () => {
    expect(nitroAddressOf('src/server/api/orders.get.ts', 'src/server')).toMatchObject({ method: 'GET', path: '/api/orders' });
    expect(nitroAddressOf('server/api/orders.get.ts', 'src/server')).toBeNull();
  });
});

describe("SvelteKit's conventions (P240)", () => {
  const KIT = { devDependencies: { '@sveltejs/kit': '^2.5.0' } };

  it('aliases `$lib` where the directory is, and each `kit.alias` as `svelte-kit sync` writes it', () => {
    const root = repo({
      'src/lib/api.ts': '',
      'src/lib/orders.ts': '',
      'svelte.config.js': "const config = { kit: { alias: { $orders: 'src/lib/orders.ts', $shared: 'src/shared', 'deep/*': 'src/deep/*' } } };\nexport default config;\n",
    });
    expect(sveltekitConventions(root, KIT)?.paths).toEqual({
      $lib: ['src/lib'],
      '$lib/*': ['src/lib/*'],
      $orders: ['src/lib/orders.ts'],
      $shared: ['src/shared'],
      '$shared/*': ['src/shared/*'],
      'deep/*': ['src/deep/*'],
    });
  });

  it('reads `kit.files.lib`, and names `$app` and `$env` as modules of the framework', () => {
    const root = repo({ 'source/lib/x.ts': '', 'svelte.config.js': "export default { kit: { files: { lib: 'source/lib' } } };" });
    const conventions = sveltekitConventions(root, KIT);
    expect(conventions?.paths).toEqual({ $lib: ['source/lib'], '$lib/*': ['source/lib/*'] });
    expect(conventions?.frameworkModules?.map((module) => module.name)).toEqual(['$app', '$env', '$service-worker']);
  });

  it('says a setting written as code, and reads the default in its place', () => {
    const root = repo({ 'src/lib/x.ts': '', 'svelte.config.js': 'export default { kit: { files: { lib: libDir() } } };' });
    const conventions = sveltekitConventions(root, KIT);
    expect(conventions?.paths).toEqual({ $lib: ['src/lib'], '$lib/*': ['src/lib/*'] });
    expect(conventions?.rows?.map((row) => [row.reason, row.symbol])).toEqual([['framework-setting-dynamic', 'kit.files.lib']]);
  });

  it('reads the routes and pages under `kit.files.routes` (P251), and the default where it is code', () => {
    const moved = repo({ 'svelte.config.js': "export default { kit: { files: { routes: 'src/app' } } };" });
    expect(sveltekitRoutesOf(moved)).toBe('src/app');
    expect(sveltekitPagesOf(moved).root).toBe('src/app');
    const coded = repo({ 'svelte.config.js': 'export default { kit: { files: { routes: routesDir() } } };' });
    expect(sveltekitRoutesOf(coded)).toBe('src/routes');
    expect(sveltekitConventions(coded, KIT)?.rows?.map((row) => row.symbol)).toEqual(['kit.files.routes']);
  });
});

describe("a Nuxt part's directories by kind (P251)", () => {
  it('reads `dir.pages`, `dir.shared` and `dir.modules` in the application and in a layer, each under its own base', () => {
    const root = repo({
      'nuxt.config.ts': "export default defineNuxtConfig({ dir: { pages: 'views', shared: 'common', modules: 'kit' }, extends: ['./base'] });",
      'app/views/index.vue': '',
      'base/nuxt.config.ts': "export default defineNuxtConfig({ dir: { pages: 'screens' } });",
    });
    const { layers } = nuxtLayersOf(root, NUXT_4);
    expect(layers.map((layer) => layer.layout.dirs)).toEqual([
      { pages: 'app/views', layouts: 'app/layouts', middleware: 'app/middleware', shared: 'common', modules: 'kit' },
      { pages: 'base/screens', layouts: 'base/layouts', middleware: 'base/middleware', shared: 'base/shared', modules: 'base/modules' },
    ]);
    const { routes } = nuxtPagesOf(root, NUXT_4, ['app/views/index.vue', 'app/pages/old.vue', 'base/screens/admin.vue', 'base/pages/no.vue']);
    expect([...routes]).toEqual([
      ['app/views/index.vue', '/'],
      ['base/screens/admin.vue', '/admin'],
    ]);
    expect(nuxtConventions(root, NUXT_4)?.paths?.['#shared']).toEqual(['common']);
  });

  it('reads the default and says it where `dir` or one of its keys is code', () => {
    const root = repo({ 'nuxt.config.ts': 'export default defineNuxtConfig({ dir: { pages: pagesDir() } });' });
    const layout = nuxtLayoutOf(root, NUXT_3);
    expect(layout.dirs.pages).toBe('pages');
    expect(layout.rows.map((row) => row.symbol)).toEqual(['dir.pages']);
  });

  it('routes only a file under the part\'s own pages directory, not another directory of that name', () => {
    const root = repo({ 'nuxt.config.ts': '' });
    const { routes } = nuxtPagesOf(root, NUXT_3, ['pages/a.vue', 'components/pages/B.vue']);
    expect([...routes]).toEqual([['pages/a.vue', '/a']]);
  });
});

describe('a Nuxt configuration read for one build, and the others compared (P251)', () => {
  const checkout = (files: Record<string, string>): string => join(repo({ '.git/HEAD': '', ...files }), 'shop');

  it('reads `$production` over the rest, and says what development builds that production does not', () => {
    const shop = checkout({
      'shop/nuxt.config.ts':
        "export default defineNuxtConfig({ extends: ['../ui'], $production: { extends: ['../prod'] }, $development: { extends: ['../mock'], dir: { pages: 'dev-pages' } } });",
      'ui/nuxt.config.ts': '',
      'prod/nuxt.config.ts': '',
      'mock/nuxt.config.ts': '',
    });
    expect(nuxtLayersOf(shop, NUXT_3).layers.map((layer) => layer.at)).toEqual(['', '../prod', '../ui']);
    expect(nuxtLayersOf(shop, NUXT_3, 'development').layers.map((layer) => layer.at)).toEqual(['', '../mock', '../ui']);
    const rows = (nuxtConventions(shop, NUXT_3)?.rows ?? []).filter((row) => row.reason === 'framework-environment-differs');
    expect(rows.map((row) => row.meta?.['environments'])).toEqual([
      [
        {
          environment: 'development',
          only: ['../mock as a layer'],
          without: ['../prod as a layer'],
          changed: ["the application's pages in dev-pages (pages in production)"],
        },
      ],
    ]);
  });

  it('compares each name `$env` writes, and says nothing where every build is alike', () => {
    const shop = checkout({ 'shop/nuxt.config.ts': "export default defineNuxtConfig({ $env: { staging: { modules: ['@nuxtjs/i18n'] }, preview: { devtools: { enabled: true } } } });" });
    const rows = (nuxtConventions(shop, NUXT_3)?.rows ?? []).filter((row) => row.reason === 'framework-environment-differs');
    expect(rows.map((row) => [row.symbol, row.meta?.['environments']])).toEqual([['staging', [{ environment: 'staging', only: ['the module @nuxtjs/i18n'], without: [], changed: [] }]]]);
    const alike = checkout({ 'shop/nuxt.config.ts': 'export default defineNuxtConfig({ $development: { devtools: { enabled: true } } });' });
    expect((nuxtConventions(alike, NUXT_3)?.rows ?? []).some((row) => row.reason === 'framework-environment-differs')).toBe(false);
  });
});

describe('what the modules of the repository give the application (P251)', () => {
  const checkout = (files: Record<string, string>): string => join(repo({ '.git/HEAD': '', ...files }), 'shop');
  const MODULE = (body: string): string =>
    `import { createResolver, defineNuxtModule } from '@nuxt/kit';\nexport default defineNuxtModule({ setup(_o, nuxt) {\n const resolver = createResolver(import.meta.url);\n${body}\n} });\n`;

  it("imports a module's names at the rank of the part that registers it, lays its aliases over the configuration's, and stamps it", () => {
    const shop = checkout({
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui'], alias: { '#kept': './kept', '#taken': './mine' } });",
      'shop/modules/cart/index.ts': MODULE(
        "addImportsDir(resolver.resolve('./names'));\nnuxt.options.alias['#taken'] = resolver.resolve('./taken');\nnuxt.options.alias['#kept'] ||= resolver.resolve('./other');\naddServerHandler({ route: '/api/cart', handler: resolver.resolve('./server/cart') });",
      ),
      'shop/modules/cart/names/useCart.ts': 'export const useCart = 1;',
      'shop/modules/cart/server/cart.ts': 'export default defineEventHandler(() => 1);',
      'ui/nuxt.config.ts': "export default defineNuxtConfig({ modules: ['./tools/report'] });",
      'ui/tools/report.ts': MODULE("addImportsDir(resolver.resolve('./report'));"),
      'ui/tools/report/useReport.ts': 'export const useReport = 1;',
    });
    const conventions = nuxtConventions(shop, NUXT_3);
    const [app, server] = conventions?.implicit ?? [];
    expect(app?.sources.map((source) => `${source.file}@${source.rank ?? 0}`)).toEqual(['modules/cart/names/useCart.ts@0', '../ui/tools/report/useReport.ts@1']);
    expect(app?.except).toEqual(expect.arrayContaining(['modules/cart/server']));
    expect(server?.within).toEqual(['server', '../ui/server', 'modules/cart/server']);
    expect(conventions?.paths).toMatchObject({ '#taken': ['modules/cart/taken'], '#kept': ['kept'] });
    expect(conventions?.files).toEqual(expect.arrayContaining(['modules/cart/index.ts', '../ui/tools/report.ts']));
    expect(conventions?.rows?.map((row) => row.reason)).toEqual(expect.arrayContaining(['framework-module-read']));
  });

  it("shows a page a module adds at the rank of its part, and serves nothing it cannot place", () => {
    const shop = checkout({
      'shop/nuxt.config.ts': '',
      'shop/modules/extra.ts': MODULE("extendPages((pages) => { pages.push({ path: '/extra', file: resolver.resolve('../extra/page.vue') }); });"),
      'shop/extra/page.vue': '<template><p /></template>',
    });
    const { routes } = nuxtPagesOf(shop, NUXT_3, ['extra/page.vue', 'pages/index.vue']);
    expect([...routes]).toEqual([
      ['pages/index.vue', '/'],
      ['extra/page.vue', '/extra'],
    ]);
  });

  it('takes a module of a sibling directory into the extent, and names the packages it cannot read', () => {
    const shop = checkout({
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ modules: ['../shared/audit.ts', '@nuxt/image'] });",
      'shared/audit.ts': MODULE(''),
    });
    const conventions = nuxtConventions(shop, NUXT_3);
    expect(conventions?.extent?.map(toPosixPath)).toEqual([toPosixPath(join(dirname(shop), 'shared'))]);
    const installed = conventions?.rows?.find((row) => row.reason === 'framework-module-installed');
    expect(installed?.meta).toMatchObject({ modules: ['@nuxt/image'], unknown: [] });
  });
});
