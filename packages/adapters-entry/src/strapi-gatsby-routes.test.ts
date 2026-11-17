import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GraphBuilder, noAdapters, parseConfig, silentLogger, type EntryAdapter, type EntryNode, type ExtractContext, type Unresolved } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it } from 'vitest';
import { gatsbyFunctionsAdapter } from './gatsby-functions.js';
import { strapiServerAdapter } from './strapi-server.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Read {
  readonly entries: EntryNode[];
  readonly unresolved: Unresolved[];
}

/** What an adapter reads of a repository: `code` read in memory, `files` written to disk for what it reads off it. */
const extract = (adapter: EntryAdapter, code: Record<string, string>, files: Record<string, string> = {}): Read => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-strapi-')));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, allowJs: true } });
  for (const [path, text] of Object.entries(code)) project.createSourceFile(join(root, path), text);
  const ctx: ExtractContext = {
    repo: 'cms',
    repoDir: root,
    service: { name: 'cms', repo: root, type: 'strapi' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'cms' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  const entries = adapter.extractEntries(ctx);
  return { entries, unresolved: ctx.builder.build().unresolved };
};

/** Each route, and where its handler is: `GET /api/products -> src/...:3 (inline)`. */
const routes = (read: Read): string[] =>
  read.entries
    .map((entry) => {
      const handler = entry.handler === undefined ? `(${String(entry.meta?.['handlerVia'])})` : `${entry.handler.file}:${entry.handler.line}`;
      return `${entry.label} -> ${handler}`;
    })
    .sort();

const schema = (kind: string, singularName: string, pluralName: string): string => JSON.stringify({ kind, info: { singularName, pluralName } });

describe("Strapi's routes (P327)", () => {
  const files = {
    'src/api/product/content-types/product/schema.json': schema('collectionType', 'product', 'products'),
    'src/api/homepage/content-types/homepage/schema.json': schema('singleType', 'homepage', 'homepage'),
  };

  it('reads a core router as its content type routes, under /api, its handlers the controller actions written', () => {
    const read = extract(
      strapiServerAdapter,
      {
        'src/api/product/routes/product.ts': "import { factories } from '@strapi/strapi';\nexport default factories.createCoreRouter('api::product.product');\n",
        'src/api/product/controllers/product.ts': [
          "import { factories } from '@strapi/strapi';",
          "export default factories.createCoreController('api::product.product', ({ strapi }) => ({",
          '  async find(ctx) {',
          '    ctx.body = await strapi.documents("api::product.product").findMany();',
          '  },',
          '}));',
        ].join('\n'),
        'src/api/homepage/routes/homepage.ts': "import { factories } from '@strapi/strapi';\nexport default factories.createCoreRouter('api::homepage.homepage', { only: ['find'] });\n",
      },
      files,
    );
    expect(routes(read)).toEqual([
      'DELETE /api/products/:id -> (framework)',
      'GET /api/homepage -> (framework)',
      'GET /api/products -> src/api/product/controllers/product.ts:3',
      'GET /api/products/:id -> (framework)',
      'POST /api/products -> (framework)',
      'PUT /api/products/:id -> (framework)',
    ]);
    expect(read.unresolved).toEqual([]);
  });

  it("reads custom routes, a router's prefix, a route's own prefix and config/api's rest.prefix", () => {
    const read = extract(
      strapiServerAdapter,
      {
        'src/api/product/routes/custom.ts': [
          'export default {',
          "  prefix: '/shop',",
          '  routes: [',
          "    { method: 'GET', path: '/products/featured', handler: 'product.featured' },",
          "    { method: 'post', path: '/products/:id/rate', handler: 'api::product.product.rate', config: { prefix: '' } },",
          "    { method: 'GET', path: '/products/missing', handler: 'product.missing' },",
          '  ],',
          '};',
        ].join('\n'),
        'src/api/product/controllers/product.ts': [
          'const rate = async (ctx) => { ctx.body = { ok: true }; };',
          'export default {',
          '  featured: async (ctx) => { ctx.body = []; },',
          '  rate,',
          '};',
        ].join('\n'),
      },
      { ...files, 'config/api.ts': "export default { rest: { prefix: '/v1' } };\n" },
    );
    expect(routes(read)).toEqual([
      'GET /v1/shop/products/featured -> src/api/product/controllers/product.ts:3',
      'GET /v1/shop/products/missing -> (unread)',
      'POST /v1/products/:id/rate -> src/api/product/controllers/product.ts:1',
    ]);
    expect(read.unresolved.map((row) => `${row.reason} ${row.symbol}`)).toEqual(['route-handler-unread product.missing']);
  });

  it('says why a routes file it cannot read is not read', () => {
    const read = extract(strapiServerAdapter, { 'src/api/order/routes/order.ts': "import { factories } from '@strapi/strapi';\nexport default factories.createCoreRouter('api::order.order');\n" });
    expect(read.entries).toEqual([]);
    expect(read.unresolved.map((row) => row.reason)).toEqual(['route-registry-unread']);
  });
});

describe('Gatsby functions (P327)', () => {
  it('reads each .js and .ts file under src/api as a way in at /api/<path>, every verb its default export answers', () => {
    const read = extract(gatsbyFunctionsAdapter, {
      'src/api/subscribe.ts': 'export default function subscribe(req, res) { res.json({ ok: true }); }',
      'src/api/users/[id].ts': 'export default function user(req, res) { res.json({ id: req.params.id }); }',
      'src/api/files/[...path].js': 'export default (req, res) => { res.send(req.params.path); };',
      'src/api/reports/index.ts': "export default function report(req, res) { if (req.method !== 'POST') return res.status(405).end(); res.json({}); }",
      'src/api/helpers.d.ts': 'export declare const x: number;',
      'src/api/__tests__/subscribe.ts': 'export default function t() {}',
      'src/api/subscribe.test.ts': 'export default function t() {}',
      'src/pages/index.tsx': 'export default function Home() { return null; }',
    });
    expect(read.entries.map((entry) => `${entry.label} ${String(entry.meta?.['rawPath'] ?? '')}`).sort()).toEqual([
      'ALL /api/files/* /api/files/:path',
      'ALL /api/subscribe /api/subscribe',
      'ALL /api/users/:param /api/users/:id',
      'POST /api/reports /api/reports',
    ]);
  });
});
