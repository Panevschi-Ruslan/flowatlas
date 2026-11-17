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

/** Each route and what stands in front of it: `GET /x [guard global::is-owner src/policies/is-owner.ts:1 runs]`. */
const wrapped = (read: Read): string[] =>
  read.entries
    .map((entry) => `${entry.label} [${(entry.wrapping ?? []).map((each) => `${each.layer} ${each.label} ${each.file}:${each.line ?? ''}${each.runs === undefined ? '' : ' runs'}`).join('; ')}]`)
    .sort();

describe("Strapi's plugins, routers written otherwise, policies and middlewares (P329)", () => {
  it("reads routes files exporting a function, a factory's result and a variable", () => {
    const read = extract(strapiServerAdapter, {
      'src/api/review/routes/fn.ts': "export default function routes() {\n  return { routes: [{ method: 'GET', path: '/reviews/top', handler: 'review.top' }] };\n}\n",
      'src/api/review/routes/factory.ts': "import { makeRouter } from '../../../utils/router';\nexport default makeRouter('/reviews/latest', 'review.latest');\n",
      'src/utils/router.ts': "export const makeRouter = (path: string, handler: string) => ({ routes: [{ method: 'GET', path: '/reviews/latest', handler: 'review.latest' }] });\n",
      'src/api/review/routes/variable.js': "const routes = { routes: [{ method: 'POST', path: '/reviews/import', handler: 'review.import' }] };\nmodule.exports = routes;\n",
      'src/api/review/routes/arrow.ts': "export default ({ strapi }) => ({ routes: [{ method: 'DELETE', path: '/reviews/stale', handler: 'review.prune' }] });\n",
      'src/api/review/controllers/review.ts': [
        'export default {',
        '  async top(ctx) { ctx.body = []; },',
        '  async latest(ctx) { ctx.body = []; },',
        '  async import(ctx) { ctx.body = {}; },',
        '  async prune(ctx) { ctx.body = {}; },',
        '};',
      ].join('\n'),
    });
    expect(routes(read)).toEqual([
      'DELETE /api/reviews/stale -> src/api/review/controllers/review.ts:5',
      'GET /api/reviews/latest -> src/api/review/controllers/review.ts:3',
      'GET /api/reviews/top -> src/api/review/controllers/review.ts:2',
      'POST /api/reviews/import -> src/api/review/controllers/review.ts:4',
    ]);
    expect(read.unresolved).toEqual([]);
  });

  it("draws a route's policies as guards and its middlewares as middleware, in Strapi's order, resolved by uid", () => {
    const read = extract(strapiServerAdapter, {
      'src/api/order/routes/custom.ts': [
        'export default {',
        '  routes: [',
        '    {',
        "      method: 'GET',",
        "      path: '/orders/mine',",
        "      handler: 'order.mine',",
        '      config: {',
        "        policies: ['global::is-signed-in', 'is-owner', { name: 'api::order.has-role', config: { role: 'editor' } }, 'admin::isAuthenticatedAdmin'],",
        "        middlewares: ['global::audit', (ctx, next) => next()],",
        '      },',
        '    },',
        '  ],',
        '};',
      ].join('\n'),
      'src/api/order/controllers/order.ts': 'export default {\n  async mine(ctx) { ctx.body = []; },\n};',
      'src/policies/is-signed-in.ts': 'export default (policyContext) => Boolean(policyContext.state.user);',
      'src/api/order/policies/is-owner.ts': 'export default function isOwner(policyContext) { return true; }',
      'src/api/order/policies/has-role.ts': 'export default { handler: (policyContext, config) => true };',
      'src/middlewares/audit.ts': 'export default (config, { strapi }) => async (ctx, next) => { await next(); };',
    });
    expect(wrapped(read)).toEqual([
      'GET /api/orders/mine [guard global::is-signed-in src/policies/is-signed-in.ts:1 runs; guard is-owner src/api/order/policies/is-owner.ts:1 runs; ' +
        'guard api::order.has-role src/api/order/policies/has-role.ts:1 runs; guard admin::isAuthenticatedAdmin src/api/order/routes/custom.ts:8; ' +
        'middleware global::audit src/middlewares/audit.ts:1 runs; middleware middleware@9 src/api/order/routes/custom.ts:9 runs]',
    ]);
  });

  it("reads a local plugin's routes, admin and content API, with its own controllers, and says what an extension adds to a plugin not held", () => {
    const read = extract(
      strapiServerAdapter,
      {
        'src/plugins/reviews/strapi-server.js': "module.exports = require('./server');\n",
        'src/plugins/reviews/server/index.js': "const routes = require('./routes');\nconst controllers = require('./controllers');\nmodule.exports = { routes, controllers };\n",
        'src/plugins/reviews/server/routes/index.js': [
          'module.exports = {',
          "  'content-api': { type: 'content-api', routes: [{ method: 'GET', path: '/summary', handler: 'review.summary' }] },",
          "  admin: () => ({ routes: [{ method: 'POST', path: '/settings', handler: 'review.settings', config: { policies: ['plugin::reviews.can-edit'] } }] }),",
          '};',
        ].join('\n'),
        'src/plugins/reviews/server/controllers/index.js': "const review = require('./review');\nmodule.exports = { review };\n",
        'src/plugins/reviews/server/controllers/review.js': [
          'module.exports = ({ strapi }) => ({',
          '  async summary(ctx) { ctx.body = {}; },',
          '  async settings(ctx) { ctx.body = {}; },',
          '});',
        ].join('\n'),
        'src/plugins/badges/strapi-server.ts': "export default {\n  routes: [{ method: 'GET', path: '/list', handler: 'badge.list' }],\n  controllers: { badge: { list: async (ctx) => { ctx.body = []; } } },\n};\n",
        'src/plugins/disabled/strapi-server.ts': "export default { routes: [{ method: 'GET', path: '/x', handler: 'x.y' }] };\n",
        'src/extensions/users-permissions/strapi-server.ts': [
          'export default (plugin) => {',
          "  plugin.routes['content-api'].routes.push({ method: 'GET', path: '/auth/session', handler: 'auth.session' });",
          '  return plugin;',
          '};',
        ].join('\n'),
      },
      {
        'config/plugins.js': [
          'module.exports = ({ env }) => ({',
          "  reviews: { enabled: true, resolve: './src/plugins/reviews' },",
          "  badges: { resolve: 'src/plugins/badges' },",
          "  disabled: { enabled: false, resolve: './src/plugins/disabled' },",
          '  seo: true,',
          '});',
        ].join('\n'),
      },
    );
    expect(routes(read)).toEqual([
      'GET /api/reviews/summary -> src/plugins/reviews/server/controllers/review.js:2',
      'GET /badges/list -> src/plugins/badges/strapi-server.ts:3',
      'POST /reviews/settings -> src/plugins/reviews/server/controllers/review.js:3',
    ]);
    expect(wrapped(read).filter((each) => each.startsWith('POST'))).toEqual(['POST /reviews/settings [guard plugin::reviews.can-edit src/plugins/reviews/server/routes/index.js:3]']);
    expect(read.unresolved.map((row) => `${row.reason} ${row.message}`)).toEqual([
      "route-mount-unread src/extensions/users-permissions/strapi-server.ts adds GET /auth/session to the routes of the plugin users-permissions, whose router and the prefix it serves them under are the plugin's own code, not the repository's, so they are not read as ways in.",
    ]);
  });
});

describe('Gatsby functions of local plugins, and under the path prefix (P329)', () => {
  it("reads a local plugin's src/api/<name> functions at /api/<name>/..., the site's own winning at one address", () => {
    const read = extract(
      gatsbyFunctionsAdapter,
      {
        'src/api/hello.ts': 'export default function hello(req, res) { res.send("site"); }',
        'src/api/newsletter/subscribe.ts': 'export default function siteSubscribe(req, res) { res.send("site"); }',
        'plugins/newsletter-local/src/api/newsletter/subscribe.ts': 'export default function pluginSubscribe(req, res) { res.send("plugin"); }',
        'plugins/newsletter-local/src/api/newsletter/[list]/members.ts': 'export default function members(req, res) { res.json([]); }',
        'plugins/newsletter-local/src/api/other/ignored.ts': 'export default function ignored(req, res) { res.end(); }',
        'plugins/unlisted/src/api/unlisted/a.ts': 'export default function a(req, res) { res.end(); }',
      },
      {
        'gatsby-config.js': "module.exports = {\n  plugins: ['gatsby-plugin-image', { resolve: 'newsletter-local', options: {} }],\n};\n",
        'plugins/newsletter-local/package.json': JSON.stringify({ name: 'newsletter' }),
        'plugins/newsletter-local/src/api/newsletter/.keep': '',
        'plugins/unlisted/package.json': JSON.stringify({ name: 'unlisted' }),
      },
    );
    expect(routes(read)).toEqual([
      'ALL /api/hello -> src/api/hello.ts:1',
      'ALL /api/newsletter/:param/members -> plugins/newsletter-local/src/api/newsletter/[list]/members.ts:1',
      'ALL /api/newsletter/subscribe -> src/api/newsletter/subscribe.ts:1',
    ]);
    expect(read.unresolved).toEqual([]);
  });

  it('reads each function under the pathPrefix too where gatsby serve runs with --prefix-paths, and says a plugin list it cannot read', () => {
    const code = { 'src/api/hello.ts': 'export default function hello(req, res) { res.send("site"); }', 'plugins/local/src/api/local/a.ts': 'export default function a(req, res) { res.end(); }' };
    const read = extract(gatsbyFunctionsAdapter, code, {
      'package.json': JSON.stringify({ scripts: { serve: 'gatsby serve --prefix-paths -p 9000' } }),
      'gatsby-config.js': "module.exports = {\n  pathPrefix: '/blog/',\n  plugins: [...shared],\n};\n",
    });
    expect(routes(read)).toEqual(['ALL /api/hello -> src/api/hello.ts:1', 'ALL /blog/api/hello -> src/api/hello.ts:1']);
    expect(read.unresolved.map((row) => `${row.reason} ${row.message}`)).toEqual([
      'route-registry-unread The plugins gatsby-config.js lists are not all written as names, so the functions of local under plugins/ are not read as ways in.',
    ]);
    const develop = extract(gatsbyFunctionsAdapter, code, {
      'package.json': JSON.stringify({ scripts: { develop: 'gatsby develop', serve: 'gatsby serve' } }),
      'gatsby-config.js': "module.exports = { pathPrefix: '/blog' };\n",
    });
    expect(routes(develop)).toEqual(['ALL /api/hello -> src/api/hello.ts:1']);
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
