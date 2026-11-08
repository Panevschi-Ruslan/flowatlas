import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ListenPort } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { astroListens, viteListens } from './dev-server.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-dev-server-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  return root;
};

const scripts = (all: Record<string, string>): string => JSON.stringify({ scripts: all }, null, 2);

/** A port as `file:line port[setting] default`, every one a dev server's. */
const said = (ports: readonly ListenPort[]): string[] =>
  ports.map((port) => {
    expect(port.devServer).toBe(true);
    return `${port.file}:${port.line} ${port.port ?? '-'}${port.setting === undefined ? '' : `[${port.setting}]`}${port.default === true ? ' default' : ''}`;
  });

describe("where a Vite front end's dev and preview servers listen (P254)", () => {
  it("reads `server.port` and `preview.port`, a setting's fallback with its setting", () => {
    const root = repo({
      'vite.config.ts': [
        "import { defineConfig } from 'vite';",
        'export default defineConfig({',
        '  plugins: [sveltekit()],',
        '  server: { host: true, port: 5174 },',
        '  preview: {',
        '    port: Number(process.env.PREVIEW_PORT) || 4180,',
        '  },',
        '});',
      ].join('\n'),
    });
    expect(said(viteListens(root))).toEqual(['vite.config.ts:4 5174', 'vite.config.ts:6 4180[PREVIEW_PORT]']);
  });

  it("reads a script's `--port` on `vite`, `vite preview`, `svelte-kit dev`, `remix vite:dev` and `react-router dev`, and not a build", () => {
    const root = repo({
      'package.json': scripts({
        dev: 'vite --port 5180 --host',
        preview: 'vite build && vite preview --port=4190',
        legacy: 'svelte-kit dev --port 5181',
        remix: 'remix vite:dev --port 5182',
        router: 'react-router dev --port 5183',
        build: 'vite build --port 5999',
        test: 'vitest --port 5998',
      }),
    });
    expect(said(viteListens(root)).sort()).toEqual(['package.json:3 5180', 'package.json:4 4190', 'package.json:5 5181', 'package.json:6 5182', 'package.json:7 5183']);
  });

  it("assumes Vite's defaults only where `strictPort` keeps it there, a preview's only where a script serves one", () => {
    expect(said(viteListens(repo({ 'vite.config.ts': 'export default defineConfig({ plugins: [react()] });', 'package.json': scripts({ dev: 'vite', preview: 'vite preview' }) })))).toEqual([]);
    expect(
      said(
        viteListens(
          repo({
            'vite.config.ts': 'export default defineConfig({\n  server: {\n    strictPort: true,\n  },\n});',
            'package.json': scripts({ dev: 'vite', preview: 'vite preview' }),
          }),
        ),
      ),
    ).toEqual(['vite.config.ts:3 5173 default', 'vite.config.ts:3 4173 default']);
    expect(said(viteListens(repo({ 'vite.config.ts': 'export default defineConfig({ server: { strictPort: true } });' })))).toEqual(['vite.config.ts:1 5173 default']);
    expect(said(viteListens(repo({ 'package.json': scripts({ dev: 'vite --strictPort' }) })))).toEqual(['package.json:3 5173 default']);
  });
});

describe("where an Astro site's dev server listens (P254)", () => {
  it("reads `server.port` and a script's `--port`, and assumes no default", () => {
    expect(said(astroListens(repo({ 'astro.config.mjs': "export default defineConfig({\n  output: 'server',\n  server: { port: 4330 },\n});", 'package.json': scripts({ dev: 'astro dev --port 4331' }) })))).toEqual([
      'astro.config.mjs:3 4330',
      'package.json:3 4331',
    ]);
    expect(said(astroListens(repo({ 'package.json': scripts({ dev: 'astro dev' }) })))).toEqual([]);
  });
});
