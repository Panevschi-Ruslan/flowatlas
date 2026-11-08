import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nuxtComponentNameOf, nuxtNameFromPath, nuxtNamesOf } from './nuxt-names.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-names-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

const NUXT_4 = { dependencies: { nuxt: '^4.1.0' } };
const COMPONENTS = { dir: 'app/components', pathPrefix: true };

describe('the names Nuxt gives by the path of a file (P255)', () => {
  it('names a component by its folders and its name, as Nuxt does', () => {
    expect(nuxtComponentNameOf('app/components/CartBadge.vue', COMPONENTS)).toEqual({ name: 'CartBadge', mode: 'all' });
    expect(nuxtComponentNameOf('app/components/base/foo/Button.vue', COMPONENTS)).toEqual({ name: 'BaseFooButton', mode: 'all' });
    // A folder the file's name already says is said once.
    expect(nuxtComponentNameOf('app/components/base/BaseButton.vue', COMPONENTS).name).toBe('BaseButton');
    expect(nuxtComponentNameOf('app/components/cart/index.vue', COMPONENTS).name).toBe('Cart');
    expect(nuxtComponentNameOf('app/components/cart-item/remove-button.vue', COMPONENTS).name).toBe('CartItemRemoveButton');
    expect(nuxtComponentNameOf('app/components/Map.client.vue', COMPONENTS)).toEqual({ name: 'Map', mode: 'client' });
    expect(nuxtComponentNameOf('app/components/Chart.server.vue', COMPONENTS)).toEqual({ name: 'Chart', mode: 'server' });
    expect(nuxtComponentNameOf('app/components/deep/Field.vue', { ...COMPONENTS, pathPrefix: false, prefix: 'Ui' }).name).toBe('UiField');
  });

  it('names a layout and a route middleware in kebab-case', () => {
    expect(nuxtNameFromPath('app/layouts/default.vue', 'app/layouts')).toBe('default');
    expect(nuxtNameFromPath('app/layouts/desktop/Wide.vue', 'app/layouts')).toBe('desktop-wide');
    expect(nuxtNameFromPath('app/middleware/myAuth.ts', 'app/middleware')).toBe('my-auth');
    expect(nuxtNameFromPath('app/middleware/guard/index.ts', 'app/middleware')).toBe('guard');
  });
});

describe('what an application registers by name (P255)', () => {
  it("reads every part's directories and its `components` setting, the higher part's where two give a name", () => {
    const root = repo({
      'nuxt.config.ts': "export default defineNuxtConfig({ extends: ['./base'], components: [{ path: '~/widgets', prefix: 'W' }, '~/components'] });",
      'app/components/Badge.vue': '<template><b /></template>',
      'app/components/Twice.vue': '<template><b /></template>',
      'app/components/twice/index.vue': '<template><b /></template>',
      'app/widgets/Clock.vue': '<template><i /></template>',
      'base/nuxt.config.ts': 'export default defineNuxtConfig({});',
      'base/components/Badge.vue': '<template><b /></template>',
      'base/components/global/Logo.vue': '<template><b /></template>',
      'base/layouts/default.vue': '<template><slot /></template>',
      'base/middleware/a.global.ts': 'export default defineNuxtRouteMiddleware(() => undefined);',
      'base/middleware/auth.ts': 'export default defineNuxtRouteMiddleware(() => undefined);',
      'app/middleware/auth.ts': 'export default defineNuxtRouteMiddleware(() => undefined);',
      'app/middleware/b.global.ts': 'export default defineNuxtRouteMiddleware(() => undefined);',
      'app/app.vue': '<template><NuxtLayout><NuxtPage /></NuxtLayout></template>',
    });
    const names = nuxtNamesOf(root, NUXT_4);
    expect(Object.fromEntries([...names.components].map(([name, files]) => [name, files.map((each) => each.file)]))).toEqual({
      Badge: ['app/components/Badge.vue'],
      WClock: ['app/widgets/Clock.vue'],
      Logo: ['base/components/global/Logo.vue'],
    });
    expect(Object.fromEntries(names.ambiguous)).toEqual({ Twice: ['app/components/Twice.vue', 'app/components/twice/index.vue'] });
    expect(Object.fromEntries(names.layouts)).toEqual({ default: 'base/layouts/default.vue' });
    // The lowest part's first, as Nuxt runs them; the application's `auth` over the layer's.
    expect(names.middleware.map((each) => [each.name, each.file, each.global])).toEqual([
      ['a-global', 'base/middleware/a.global.ts', true],
      ['auth', 'app/middleware/auth.ts', false],
      ['b-global', 'app/middleware/b.global.ts', true],
    ]);
    expect(names.root).toBe('app/app.vue');
    expect(names.rows.map((row) => [row.reason, row.file])).toEqual([
      ['framework-layer-overridden', 'base/components/Badge.vue'],
      ['framework-layer-overridden', 'base/middleware/auth.ts'],
    ]);
  });

  it('gives no component for `components: false`, says one written as code, and names what a known module registers', () => {
    const none = repo({ 'nuxt.config.ts': "export default defineNuxtConfig({ components: false, modules: ['@nuxt/image'] });", 'app/components/A.vue': '<template />' });
    expect(nuxtNamesOf(none, NUXT_4).components.size).toBe(0);
    expect([...nuxtNamesOf(none, NUXT_4).packaged]).toEqual(['NuxtImg', 'NuxtPicture']);
    const coded = repo({ 'nuxt.config.ts': 'export default defineNuxtConfig({ components: dirs });', 'app/components/A.vue': '<template />' });
    const read = nuxtNamesOf(coded, NUXT_4);
    expect([...read.components.keys()]).toEqual(['A']);
    expect(read.rows.map((row) => [row.reason, row.symbol])).toEqual([['framework-setting-dynamic', 'components']]);
  });
});
