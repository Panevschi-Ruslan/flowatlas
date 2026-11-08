import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type ProxyReading } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it } from 'vitest';
import { nextProxies, nitroProxies, proxyConfigFile, rewriteOfFunction } from './proxy-config.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const repo = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-proxy-')));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const ctxOf = (root: string): ExtractContext => {
  const project = new Project({ useInMemoryFileSystem: true });
  return {
    repo: 'web',
    repoDir: root,
    service: { name: 'web', repo: root, type: 'nuxt' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'web' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
};

/** Each rule as `file:line prefix -> target+to`, `after` where the server's own routes answer first; each row as `file:line key: why`. */
const said = (read: ProxyReading): string[] => [
  ...read.rules.map(
    (rule) =>
      `${rule.file}:${rule.line} ${rule.path} -> ${rule.setting === undefined ? '' : `[${rule.setting.name}]${rule.setting.to} or `}${rule.target}${rule.to}` +
      `${rule.rewrite === undefined ? '' : ` ${rule.rewrite.source} => ${rule.rewrite.with}`}${rule.after === undefined ? '' : ' after'}`,
  ),
  ...read.rows.map((row) => `${row.file}:${row.line} ${row.symbol}: ${String(row.message).replace(/^.*is not read: /, '')}`),
];

describe('a rewrite that replaces the prefix with a literal (P257)', () => {
  it('is read from a function written as a replace of the prefix', () => {
    expect(rewriteOfFunction("(path) => path.replace(/^\\/api/, '')", '/api')).toEqual({ kind: 'strip' });
    expect(rewriteOfFunction("p => p.replace('/api', '/v1')", '/api')).toEqual({ kind: 'replace', with: '/v1' });
    expect(rewriteOfFunction('(path: string) => { return path.replace(/^\\/api\\//, "/") }', '/api')).toEqual({ kind: 'strip' });
  });

  it('is nothing for any other function', () => {
    expect(rewriteOfFunction('(path) => rewrite(path)', '/api')).toBeUndefined();
    expect(rewriteOfFunction("(path) => path.replace(/[/, '')", '/api')).toBeUndefined();
  });

  it('reads any other regular expression replaced by a literal as a rewrite of the whole path (P260)', () => {
    expect(rewriteOfFunction("(path) => path.replace(/^\\/api\\/v\\d+/, '')", '/api')).toEqual({ kind: 'pattern', source: '^/api/v\\d+', with: '' });
    expect(rewriteOfFunction("(path) => path.replace(/^\\/other/i, '/x')", '/api')).toEqual({ kind: 'pattern', source: '^/other', flags: 'i', with: '/x' });
    expect(rewriteOfFunction("(p) => p.replace('/old.', '/new')", '')).toEqual({ kind: 'pattern', source: '/old\\.', with: '/new' });
  });
});

describe('a proxy configuration file a dev server is started with (P257)', () => {
  it('reads a table of prefixes, with each one rewrite', () => {
    const root = repo({
      'proxy.conf.json': JSON.stringify(
        {
          '/billing': { target: 'http://localhost:3004', secure: false, pathRewrite: { '^/billing': '' } },
          '/catalog/**': 'http://localhost:3003',
          '^/regex/.*': { target: 'http://localhost:3009' },
          '/legacy': { target: 'http://localhost:3010', pathRewrite: { '^/legacy/v\\d': '' } },
        },
        null,
        2,
      ),
    });
    expect(said(proxyConfigFile(root, 'proxy.conf.json', 'angular', { file: 'angular.json', line: 9 }))).toEqual([
      'proxy.conf.json:2 /billing -> http://localhost:3004',
      'proxy.conf.json:9 /catalog -> http://localhost:3003/catalog',
      'proxy.conf.json:13 /legacy -> http://localhost:3010 ^/legacy/v\\d => ',
      'proxy.conf.json:10 ^/regex/.*: its prefix is a pattern, not a path',
    ]);
  });

  it("reads a module's literal list of contexts, and says where the file named is missing", () => {
    const root = repo({
      'proxy.conf.js': "module.exports = [\n  {\n    context: ['/orders', '/stock'],\n    target: 'http://localhost:3001',\n  },\n];\n",
    });
    expect(said(proxyConfigFile(root, 'proxy.conf.js', 'angular', { file: 'angular.json', line: 9 }))).toEqual([
      'proxy.conf.js:3 /orders -> http://localhost:3001/orders',
      'proxy.conf.js:3 /stock -> http://localhost:3001/stock',
    ]);
    expect(said(proxyConfigFile(root, 'gone.json', 'angular', { file: 'angular.json', line: 9 }))).toEqual([
      'angular.json:9 gone.json: the proxy configuration it names is not in the repository',
    ]);
  });
});

describe("Nitro's and Nuxt's proxies (P257)", () => {
  it('reads `devProxy` with its prefix taken off, and a route rule that proxies the rest of the path', () => {
    const root = repo({
      'nuxt.config.ts': [
        'export default defineNuxtConfig({',
        '  routeRules: {',
        "    '/orders-api/**': { proxy: 'http://localhost:3001/**' },",
        "    '/one/**': { proxy: 'http://localhost:3001/health' },",
        '  },',
        '  nitro: {',
        '    devProxy: {',
        "      '/catalog': { target: 'http://localhost:3003', changeOrigin: true },",
        "      '/stock': process.env.STOCK_URL,",
        '    },',
        '  },',
        '});',
      ].join('\n'),
    });
    expect(said(nitroProxies(ctxOf(root)))).toEqual([
      'nuxt.config.ts:8 /catalog -> http://localhost:3003',
      'nuxt.config.ts:9 /stock -> [STOCK_URL] or ',
      'nuxt.config.ts:3 /orders-api -> http://localhost:3001',
      'nuxt.config.ts:4 /one/**: it sends every path under it to one address',
    ]);
  });
});

describe("Next's rewrites to an address outside the application (P257)", () => {
  it('reads a list (after its own files) and `beforeFiles` (before them), and leaves a rewrite inside the application', () => {
    const root = repo({
      'next.config.js': [
        'module.exports = {',
        '  async rewrites() {',
        '    return {',
        "      beforeFiles: [{ source: '/edge/:path*', destination: 'http://localhost:3005/:path*' }],",
        '      afterFiles: [',
        "        { source: '/shop-api/:path*', destination: 'http://localhost:3001/v1/:path*' },",
        "        { source: '/old', destination: '/new' },",
        "        { source: '/beta/:path*', destination: 'http://localhost:3002/:path*', has: [{ type: 'header', key: 'x-beta' }] },",
        "        { source: '/x/:id/y', destination: 'http://localhost:3002/:id' },",
        '      ],',
        '    };',
        '  },',
        '};',
      ].join('\n'),
    });
    expect(said(nextProxies(ctxOf(root)))).toEqual([
      'next.config.js:4 /edge -> http://localhost:3005',
      'next.config.js:6 /shop-api -> http://localhost:3001/v1 after',
      'next.config.js:8 /beta/:path*: it applies only to requests a condition (has, missing) picks',
      'next.config.js:9 /x/:id/y: its source or destination has parameters other than one trailing catch-all',
    ]);
  });

  it('reads a configuration a wrapper is handed, its rewrites an arrow answering a list', () => {
    const root = repo({
      'next.config.mjs': [
        "const nextConfig = { rewrites: async () => [{ source: '/api/:path*', destination: 'http://localhost:4000/:path*' }] };",
        'export default withPlugins(nextConfig);',
      ].join('\n'),
    });
    expect(said(nextProxies(ctxOf(root)))).toEqual(['next.config.mjs:1 /api -> http://localhost:4000 after']);
  });

  it('reads a destination built over a setting, and says the server resolves its own requests with no host (P260)', () => {
    const root = repo({
      'next.config.js': [
        'module.exports = {',
        '  async rewrites() {',
        '    return [',
        "      { source: '/orders/:path*', destination: `${process.env.ORDERS_URL}/orders/:path*` },",
        "      { source: '/all/:path*', destination: `${process.env.ALL_URL}` },",
        '    ];',
        '  },',
        '};',
      ].join('\n'),
    });
    const read = nextProxies(ctxOf(root));
    expect(said(read)).toEqual([
      'next.config.js:4 /orders -> [ORDERS_URL]/orders or /orders after',
      'next.config.js:5 /all/:path*: its source or destination has parameters other than one trailing catch-all',
    ]);
    expect(read.ownOrigin).toBe(true);
    expect(nextProxies(ctxOf(repo({ 'package.json': '{}' }))).ownOrigin).toBe(true);
  });
});

describe("a proxy's router, and a target read from a setting (P260)", () => {
  it('reads the paths a router sends elsewhere under the prefix, rewritten as the prefix is, and says where it routes by host', () => {
    const root = repo({
      'proxy.conf.js': [
        'module.exports = {',
        "  '/billing': {",
        "    target: process.env.BILLING_URL || 'http://localhost:3004',",
        "    pathRewrite: { '^/billing': '' },",
        '    router: {',
        "      '/billing/v2': 'http://localhost:3006',",
        "      'admin.localhost:4300': 'http://localhost:3007',",
        "      '/elsewhere': 'http://localhost:3008',",
        '    },',
        '  },',
        "  '/ledger': { target: 'http://localhost:3009', router: (req) => pick(req) },",
        '};',
      ].join('\n'),
    });
    expect(said(proxyConfigFile(root, 'proxy.conf.js', 'angular', { file: 'angular.json', line: 9 }))).toEqual([
      'proxy.conf.js:2 /billing -> [BILLING_URL] or http://localhost:3004',
      'proxy.conf.js:6 /billing/v2 -> http://localhost:3006/v2',
      'proxy.conf.js:11 /ledger -> http://localhost:3009/ledger',
      'proxy.conf.js:7 admin.localhost:4300: its router sends by the request\'s host, which a request with no host does not say',
      'proxy.conf.js:11 /ledger: its router is not written as a table of literals',
    ]);
  });
});
