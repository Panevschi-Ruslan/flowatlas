import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { orpcProceduresAdapter, trpcProceduresAdapter } from './procedure-routers.js';
import { viteConventions } from './vite-conventions.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-vite-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

describe("a Vite configuration's aliases (P240)", () => {
  it('reads an object of aliases, each path the way the scaffold builds it', () => {
    const root = repo({
      'src/api/client.ts': '',
      'vite.config.ts': [
        "import { fileURLToPath, URL } from 'node:url';",
        "import path from 'node:path';",
        'export default defineConfig({',
        '  resolve: {',
        '    alias: {',
        "      '@': fileURLToPath(new URL('./src', import.meta.url)),",
        "      '#api': path.resolve(__dirname, 'src/api'),",
        "      '~root': '/src',",
        "      vue: 'vue/dist/vue.esm-bundler.js',",
        '    },',
        '  },',
        '});',
      ].join('\n'),
    });
    expect(viteConventions(root, {})?.paths).toEqual({
      '@': ['src'],
      '@/*': ['src/*'],
      '#api': ['src/api'],
      '#api/*': ['src/api/*'],
      '~root': ['src'],
      '~root/*': ['src/*'],
    });
  });

  it('reads a list of `{ find, replacement }`, and says a pattern it cannot', () => {
    const root = repo({
      'src/x.ts': '',
      'vite.config.mjs': "export default { resolve: { alias: [{ find: '@', replacement: './src' }, { find: /^~/, replacement: './src' }] } };",
    });
    const conventions = viteConventions(root, {});
    expect(conventions?.paths).toEqual({ '@': ['src'], '@/*': ['src/*'] });
    expect(conventions?.rows?.map((row) => [row.reason, row.symbol])).toEqual([['framework-setting-dynamic', 'resolve.alias[1]']]);
  });

  it('is stated by the procedure adapters too, so a server Vite builds resolves through them (P256)', () => {
    expect(orpcProceduresAdapter.conventions).toBe(viteConventions);
    expect(trpcProceduresAdapter.conventions).toBe(viteConventions);
    const root = repo({ 'src/lib/reports.ts': '', 'vite.config.ts': "export default { resolve: { alias: { '@lib': './src/lib' } } };" });
    expect(orpcProceduresAdapter.conventions?.(root, {})?.paths).toEqual({ '@lib': ['src/lib'], '@lib/*': ['src/lib/*'] });
  });

  it('states nothing for a configuration with no alias, or no configuration', () => {
    expect(viteConventions(repo({ 'vite.config.ts': 'export default defineConfig({ plugins: [] });' }), {})).toBeUndefined();
    expect(viteConventions(repo({}), {})).toBeUndefined();
  });
});
