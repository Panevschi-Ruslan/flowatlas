import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nuxtConventions, nuxtLayoutOf, sveltekitConventions } from './framework-conventions.js';
import { nitroAddressOf } from './nuxt-routes.js';

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

  it('says each layer it does not read, written or under `layers/`', () => {
    const root = repo({ 'nuxt.config.ts': "export default defineNuxtConfig({ extends: ['github:example/base', ['./theme', { install: true }]] });", 'layers/admin/nuxt.config.ts': '' });
    const rows = nuxtConventions(root, NUXT_3)?.rows ?? [];
    expect(rows.filter((row) => row.reason === 'framework-layer-unread').map((row) => row.symbol)).toEqual(['github:example/base', './theme', 'layers/admin']);
  });

  it('states nothing for a repository that does not declare Nuxt', () => {
    expect(nuxtConventions(repo({}), { dependencies: { h3: '^1.0.0' } })).toBeUndefined();
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
});
