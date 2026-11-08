import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProxyReading } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { frontEndProxies, reactScriptsProxy, viteProxies } from './dev-proxy.js';
import { frontEndListens } from './dev-server.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-dev-proxy-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

/** Each rule as `file:line prefix -> target+to`, and each row as `file:line key: why`. */
const said = (read: ProxyReading): string[] => [
  ...read.rules.map((rule) => `${rule.file}:${rule.line} ${rule.path} -> ${rule.target}${rule.to}${rule.after === undefined ? '' : ' after'}`),
  ...read.rows.map((row) => `${row.file}:${row.line} ${row.symbol}: ${String(row.message).replace(/^.*is not read: /, '')}`),
];

describe("where a Vite front end's dev server forwards a path (P257)", () => {
  it('reads a target written as a string or as `{ target }`, and a rewrite that replaces the prefix', () => {
    const root = repo({
      'vite.config.ts': [
        "import { defineConfig } from 'vite';",
        'export default defineConfig({',
        '  server: {',
        '    port: 5180,',
        '    proxy: {',
        "      '/products': 'http://localhost:3003',",
        "      '/api': {",
        "        target: 'http://localhost:3001',",
        '        changeOrigin: true,',
        "        rewrite: (path) => path.replace(/^\\/api/, ''),",
        '      },',
        "      '^/fallback/.*': 'http://localhost:3009',",
        "      '/legacy': { target: process.env.LEGACY_URL },",
        "      '/odd': { target: 'http://localhost:3010', rewrite: (path) => path.toLowerCase() },",
        '    },',
        '  },',
        '});',
      ].join('\n'),
    });
    expect(said(viteProxies(root))).toEqual([
      'vite.config.ts:6 /products -> http://localhost:3003/products',
      'vite.config.ts:7 /api -> http://localhost:3001',
      'vite.config.ts:12 ^/fallback/.*: its prefix is a pattern, not a path',
      'vite.config.ts:13 /legacy: its target is not written as an address',
      'vite.config.ts:14 /odd: its rewrite is not a literal replacement of the prefix',
    ]);
  });

  it('says so where the whole table is code', () => {
    const root = repo({ 'vite.config.ts': 'export default defineConfig({\n  server: {\n    proxy: makeProxy(),\n  },\n});' });
    expect(said(viteProxies(root))).toEqual(['vite.config.ts:3 server.proxy: it is not written as a literal']);
  });
});

describe("Create React App's `proxy` and a workspace tool's dev server targets (P257)", () => {
  it("forwards everything the dev server has no file for to the one address, after its own", () => {
    const root = repo({ 'package.json': JSON.stringify({ name: 'legacy', proxy: 'http://localhost:3004' }, null, 2) });
    expect(said(reactScriptsProxy(root))).toEqual(['package.json:3 / -> http://localhost:3004 after']);
  });

  it("reads the port and the proxy configuration a webpack or Vite dev server target is run with", () => {
    const root = repo({
      'project.json': JSON.stringify(
        {
          name: 'store',
          targets: {
            serve: { executor: '@nx/webpack:dev-server', options: { port: 4210, proxyConfig: 'proxy.conf.json' } },
            preview: { executor: '@nx/vite:preview-server', options: { port: 4310 } },
          },
        },
        null,
        2,
      ),
      'proxy.conf.json': JSON.stringify({ '/api': { target: 'http://localhost:3001', pathRewrite: { '^/api': '' } } }, null, 2),
    });
    const ctx = { repoDir: root } as Parameters<typeof frontEndProxies>[0];
    expect(said(frontEndProxies(ctx))).toEqual(['proxy.conf.json:2 /api -> http://localhost:3001']);
    expect(frontEndListens(ctx).map((port) => `${port.file}:${port.line} ${port.port}${port.devServer === true ? ' dev' : ''}`)).toEqual([
      'project.json:14 4310 dev',
      'project.json:7 4210 dev',
    ]);
  });
});
