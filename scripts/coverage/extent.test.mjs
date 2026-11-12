/**
 * The harness's extent, where a framework's configuration says what a service
 * is built from (P251).
 *
 * Each case is a small clone written to a temporary directory: a workspace
 * root, an application, and what its configuration names beside it. The
 * extent is asked of the application, as the harness asks it of a read root.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { extentOf } from './extent.mjs';

const clones = [];
after(() => {
  for (const clone of clones) rmSync(clone, { recursive: true, force: true });
});

const clone = (files) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-extent-')));
  clones.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
};

const WORKSPACE = { name: 'root', private: true, workspaces: ['shop', 'ui-layer', 'tokens', 'brand', 'mock', 'audit'] };
const NUXT_APP = { name: 'shop', dependencies: { nuxt: '^4.1.0' } };

describe('the extent a framework configuration adds (P251)', () => {
  it('counts a layer extended by its path, and the layer that one extends in turn', () => {
    const root = clone({
      'package.json': WORKSPACE,
      'shop/package.json': NUXT_APP,
      'shop/nuxt.config.ts': "export default defineNuxtConfig({\n  // beside the application\n  extends: ['../ui-layer'],\n});\n",
      'ui-layer/package.json': { name: 'ui-layer' },
      'ui-layer/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../tokens'] });",
      'tokens/package.json': { name: 'tokens' },
    });
    assert.deepEqual(extentOf(root, 'shop').dirs, ['shop', 'tokens', 'ui-layer']);
  });

  it('counts a workspace layer by its name the manifest does not declare, and a module directory by its path', () => {
    const root = clone({
      'package.json': WORKSPACE,
      'shop/package.json': NUXT_APP,
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: [['brand', { meta: {} }]], modules: ['../audit/module.ts', '@nuxtjs/i18n'] });",
      'brand/package.json': { name: 'brand' },
      'audit/package.json': { name: 'audit-tools' },
      'audit/module.ts': 'export default {};',
    });
    assert.deepEqual(extentOf(root, 'shop').dirs, ['shop', 'audit', 'brand']);
  });

  it('counts what the production build extends, and not what only development does', () => {
    const root = clone({
      'package.json': WORKSPACE,
      'shop/package.json': NUXT_APP,
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ $production: { extends: ['../ui-layer'] }, $development: { extends: ['../mock'] } });",
      'ui-layer/package.json': { name: 'ui-layer' },
      'mock/package.json': { name: 'mock' },
    });
    assert.deepEqual(extentOf(root, 'shop').dirs, ['shop', 'ui-layer']);
  });

  it('reads no configuration of a framework the manifest does not declare, and no entry written as code', () => {
    const root = clone({
      'package.json': WORKSPACE,
      'shop/package.json': { name: 'shop' },
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: ['../ui-layer'] });",
      'ui-layer/package.json': { name: 'ui-layer' },
    });
    assert.deepEqual(extentOf(root, 'shop').dirs, ['shop']);
    const coded = clone({
      'package.json': WORKSPACE,
      'shop/package.json': NUXT_APP,
      'shop/nuxt.config.ts': "export default defineNuxtConfig({ extends: [process.env.LAYER, '../ui' + '-layer'] });",
      'ui-layer/package.json': { name: 'ui-layer' },
    });
    assert.deepEqual(extentOf(coded, 'shop').dirs, ['shop']);
  });

  it('counts a layer whose path is built from the directory of the configuration (P255)', () => {
    const root = clone({
      'package.json': WORKSPACE,
      'shop/package.json': NUXT_APP,
      'shop/nuxt.config.ts': [
        "import { fileURLToPath } from 'node:url';",
        "import { join, resolve } from 'node:path';",
        'export default defineNuxtConfig({',
        "  extends: [fileURLToPath(new URL('../ui-layer', import.meta.url)), resolve(__dirname, '../tokens'), join(import.meta.dirname, '..', 'brand'), resolve('../mock')],",
        "  modules: [resolve(base, '../audit')],",
        '});',
      ].join('\n'),
      'ui-layer/package.json': { name: 'ui-layer' },
      'tokens/package.json': { name: 'tokens' },
      'brand/package.json': { name: 'brand' },
      'mock/package.json': { name: 'mock' },
      'audit/package.json': { name: 'audit-tools' },
      'audit/module.ts': 'export default {};',
    });
    // `resolve(base, ...)` starts from a name the configuration holds: code, not counted.
    assert.deepEqual(extentOf(root, 'shop').dirs, ['shop', 'brand', 'mock', 'tokens', 'ui-layer']);
  });
});
