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
const extract = (adapter: EntryAdapter, code: Record<string, string>, files: Record<string, string> = {}, pkg: ExtractContext['pkg'] = {}): Read => {
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
    pkg,
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
    // A key resolving a directory without enabled: true does not enable it, as getEnabledPlugins reads it (P335).
    expect(routes(read)).toEqual([
      'GET /api/reviews/summary -> src/plugins/reviews/server/controllers/review.js:2',
      'POST /reviews/settings -> src/plugins/reviews/server/controllers/review.js:3',
    ]);
    expect(wrapped(read).filter((each) => each.startsWith('POST'))).toEqual(['POST /reviews/settings [guard plugin::reviews.can-edit src/plugins/reviews/server/routes/index.js:3]']);
    expect(read.unresolved.map((row) => `${row.reason} ${row.message}`)).toEqual([
      'route-registry-unread The routes of the Strapi plugin seo are not read: config/plugins enables it, and no package of that name is installed in the repository.',
      'route-mount-unread src/extensions/users-permissions/strapi-server.ts adds GET /auth/session to the routes of the plugin users-permissions, which is not installed in the repository nor one of its own, so its router and the prefix it serves them under are not read, nor are they as ways in.',
      'plugin-not-enabled src/plugins/badges/strapi-server.ts is the server of a Strapi plugin no key of config/plugins enables - Strapi loads a plugin of the repository only where a key resolves its directory with enabled: true - so its routes are not served and not drawn.',
    ]);
  });
});

describe("Strapi's routes registered in code, installed plugins and extensions of plugins read (P335)", () => {
  it("reads routes registered on Strapi's server in register and bootstrap, as server.routes mounts them", () => {
    const read = extract(strapiServerAdapter, {
      'src/index.ts': [
        'export default {',
        '  register({ strapi }) {',
        "    strapi.server.routes({ type: 'content-api', prefix: '/v2', routes: [{ method: 'GET', path: '/health', handler: 'api::order.order.health' }] });",
        "    strapi.server.routes([{ method: 'POST', path: '/hooks/build', handler: async (ctx) => { ctx.body = {}; } }]);",
        "    strapi.server.api('admin').routes({ routes: [{ method: 'GET', path: '/reports', handler: 'api::order.order.report' }] });",
        "    strapi.server.routes({ type: 'public', routes: [{ method: 'GET', path: '/x', handler: 'api::order.order.health' }] });",
        '  },',
        '  bootstrap({ strapi }) {',
        "    strapi.server.router.get('/ping', async (ctx) => { ctx.body = 'pong'; });",
        "    strapi.server.routes([{ method: 'GET', path: '/legacy', handler: 'order.health' }]);",
        '  },',
        '};',
      ].join('\n'),
      'src/api/order/controllers/order.ts': 'export default {\n  async health(ctx) { ctx.body = {}; },\n  async report(ctx) { ctx.body = []; },\n};\n',
    });
    expect(routes(read)).toEqual([
      'GET /api/v2/health -> src/api/order/controllers/order.ts:2',
      'GET /legacy -> (unread)',
      'GET /ping -> src/index.ts:9',
      'GET /reports -> src/api/order/controllers/order.ts:3',
      'POST /hooks/build -> src/index.ts:4',
    ]);
    expect(read.entries.map((entry) => entry.meta?.['registration'])).toEqual(Array(5).fill('strapi/server-routes'));
    expect(read.unresolved.map((row) => `${row.reason} ${row.line}`)).toEqual(['route-registry-unread 6', 'route-handler-unread 10']);
  });

  it("reads an installed plugin's routers from its package, the handlers an extension writes, and what an extension pushes into a plugin's router", () => {
    const read = extract(
      strapiServerAdapter,
      {
        'src/extensions/ratings/strapi-server.ts': [
          'export default (plugin) => {',
          "  plugin.routes['content-api'].routes.push({ method: 'GET', path: '/ratings/top', handler: 'rating.top' });",
          '  plugin.controllers.rating.top = async (ctx) => { ctx.body = []; };',
          '  plugin.controllers.rating.create = async (ctx) => { ctx.body = {}; };',
          '  return plugin;',
          '};',
        ].join('\n'),
        'src/plugins/reviews/strapi-server.js': "module.exports = {\n  routes: [{ method: 'GET', path: '/list', handler: 'review.list' }],\n  controllers: { review: { list: async (ctx) => { ctx.body = []; } } },\n};\n",
        'src/extensions/reviews/strapi-server.js': [
          'module.exports = (server) => {',
          "  server.routes.push({ method: 'POST', path: '/import', handler: 'review.import' });",
          '  server.controllers.review.import = async (ctx) => { ctx.body = {}; };',
          "  server.routes = server.routes.filter((route) => route.path !== '/list');",
          '  return server;',
          '};',
        ].join('\n'),
      },
      {
        'config/plugins.js': "module.exports = {\n  reviews: { enabled: true, resolve: './src/plugins/reviews' },\n};\n",
        'node_modules/strapi-plugin-ratings/package.json': JSON.stringify({ name: 'strapi-plugin-ratings', strapi: { kind: 'plugin', name: 'ratings' } }),
        'node_modules/strapi-plugin-ratings/strapi-server.js': "'use strict';\nmodule.exports = require('./dist/server');\n",
        'node_modules/strapi-plugin-ratings/dist/server/index.js': [
          "'use strict';",
          'const contentApi = {',
          "  type: 'content-api',",
          "  routes: [{ method: 'GET', path: '/ratings', handler: 'rating.find' }, { method: 'POST', path: '/ratings', handler: 'rating.create', config: { policies: ['plugin::ratings.is-author'] } }],",
          '};',
          "const routes = { 'content-api': contentApi };",
          'const rating = { find: async (ctx) => {}, create: async (ctx) => {} };',
          'var index = { routes, controllers: { rating } };',
          'module.exports = index;',
        ].join('\n'),
        'node_modules/lodash/package.json': JSON.stringify({ name: 'lodash' }),
      },
      { dependencies: { 'strapi-plugin-ratings': '1.0.0', lodash: '4.17.21', 'not-installed': '1.0.0' } },
    );
    expect(routes(read)).toEqual([
      'GET /api/ratings/ratings -> (package)',
      'GET /api/ratings/ratings/top -> src/extensions/ratings/strapi-server.ts:3',
      'GET /reviews/list -> src/plugins/reviews/strapi-server.js:3',
      'POST /api/ratings/ratings -> src/extensions/ratings/strapi-server.ts:4',
      'POST /reviews/import -> src/extensions/reviews/strapi-server.js:3',
    ]);
    const ratings = read.entries.find((entry) => entry.label === 'GET /api/ratings/ratings');
    expect([ratings?.file, ratings?.meta?.['package'], ratings?.meta?.['declaredIn']]).toEqual(['package.json', 'strapi-plugin-ratings', 'node_modules/strapi-plugin-ratings/dist/server/index.js']);
    expect(wrapped(read).filter((each) => each.startsWith('POST /api/ratings'))).toEqual(['POST /api/ratings/ratings [guard plugin::ratings.is-author package.json:1]']);
    expect(read.unresolved.map((row) => `${row.reason} ${row.file} ${row.message}`)).toEqual([
      "route-mount-unread src/extensions/reviews/strapi-server.js src/extensions/reviews/strapi-server.js changes the routes of the plugin reviews otherwise than by pushing a route written as a literal into one of its routers - its write of server.routes - so what that changes is not read.",
    ]);
  });

  it("reads the source an installed plugin ships for its server, a content API routes factory and lists spread into it", () => {
    const pkg = 'node_modules/@shop/strapi-plugin-accounts';
    const read = extract(
      strapiServerAdapter,
      {},
      {
        [`${pkg}/package.json`]: JSON.stringify({
          name: '@shop/strapi-plugin-accounts',
          exports: { './strapi-server': { source: './server/index.js', require: './dist/server/index.js' } },
          strapi: { kind: 'plugin', name: 'accounts' },
        }),
        [`${pkg}/dist/server/index.js`]: "'use strict';\nvar index = require('./index2.js').__require();\nmodule.exports = index;\n",
        [`${pkg}/server/index.js`]: "'use strict';\nconst routes = require('./routes');\nmodule.exports = () => ({ routes });\n",
        [`${pkg}/server/routes/index.js`]: "'use strict';\nmodule.exports = { admin: require('./admin'), 'content-api': require('./content-api') };\n",
        [`${pkg}/server/routes/admin.js`]: "'use strict';\nconst settings = [{ method: 'GET', path: '/settings', handler: 'settings.get' }];\nmodule.exports = { type: 'admin', routes: [...settings] };\n",
        [`${pkg}/server/routes/content-api.js`]: [
          "'use strict';",
          "const { createContentApiRoutesFactory } = require('@strapi/utils');",
          'const sessionRoutes = (strapi) => {',
          "  return [{ method: 'POST', path: '/session', handler: 'session.create', config: { prefix: '' } }];",
          '};',
          "module.exports = createContentApiRoutesFactory(() => [...sessionRoutes(strapi), { method: 'GET', path: '/me', handler: 'session.me' }]);",
        ].join('\n'),
      },
      { dependencies: { '@shop/strapi-plugin-accounts': '2.0.0' } },
    );
    expect(routes(read)).toEqual(['GET /accounts/settings -> (package)', 'GET /api/accounts/me -> (package)', 'POST /api/session -> (package)']);
    expect(read.unresolved).toEqual([]);
  });

  it("says a plugin's server it cannot read, and a key resolving a plugin from a value that is no path", () => {
    const read = extract(
      strapiServerAdapter,
      { 'src/plugins/built/strapi-server.js': "module.exports = require('./dist/server');\n" },
      { 'config/plugins.js': "module.exports = {\n  built: { enabled: true, resolve: './src/plugins/built' },\n  computed: { enabled: true, resolve: pluginPath('x') },\n};\n" },
    );
    expect(read.unresolved.map((row) => `${row.reason} ${row.message}`)).toEqual([
      "route-registry-unread The routes of the Strapi plugin computed are not read: config/plugins resolves it from pluginPath('x') not written as a path.",
      'route-registry-unread The routes of src/plugins/built/strapi-server.js are not read: its server entry does not export an object, nor a function returning one, that is read.',
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
    // A plugin listed by a name installed nowhere here is said once (P335).
    expect(read.unresolved.map((row) => `${row.level ?? 'action'} ${row.reason} ${row.symbol}`)).toEqual(['info route-registry-unread gatsby-plugin-image']);
  });

  it('reads plugins listed by a path and installed under node_modules (P335)', () => {
    const read = extract(
      gatsbyFunctionsAdapter,
      {
        'src/api/hello.ts': 'export default function hello(req, res) { res.send("site"); }',
        'my-plugins/contact/src/api/contact/send.ts': 'export default function send(req, res) { res.end(); }',
        'vendor/search/src/api/search/query.ts': 'export default function query(req, res) { res.end(); }',
        'other/poll/src/api/poll/vote.ts': 'export default function vote(req, res) { res.end(); }',
      },
      {
        'gatsby-config.js': [
          "const path = require('path');",
          'module.exports = {',
          '  plugins: [',
          "    { resolve: require.resolve('./my-plugins/contact') },",
          "    { resolve: path.resolve(__dirname, 'vendor/search') },",
          "    './other/poll',",
          "    'gatsby-plugin-forms',",
          '  ],',
          '};',
        ].join('\n'),
        'my-plugins/contact/package.json': JSON.stringify({ name: 'contact', main: 'index.js' }),
        'my-plugins/contact/index.js': '',
        'vendor/search/package.json': JSON.stringify({ name: 'search' }),
        'other/poll/package.json': JSON.stringify({ name: 'poll' }),
        'node_modules/gatsby-plugin-forms/package.json': JSON.stringify({ name: 'gatsby-plugin-forms' }),
        'node_modules/gatsby-plugin-forms/src/api/gatsby-plugin-forms/submit.js': 'module.exports = (req, res) => res.end();',
        'node_modules/gatsby-plugin-forms/src/api/gatsby-plugin-forms/__tests__/submit.js': '',
      },
    );
    expect(routes(read)).toEqual([
      'ALL /api/contact/send -> my-plugins/contact/src/api/contact/send.ts:1',
      'ALL /api/gatsby-plugin-forms/submit -> (package)',
      'ALL /api/hello -> src/api/hello.ts:1',
      'ALL /api/poll/vote -> other/poll/src/api/poll/vote.ts:1',
      'ALL /api/search/query -> vendor/search/src/api/search/query.ts:1',
    ]);
    const forms = read.entries.find((entry) => entry.meta?.['package'] !== undefined);
    expect([forms?.file, forms?.meta?.['declaredIn']]).toEqual(['gatsby-config.js', 'node_modules/gatsby-plugin-forms/src/api/gatsby-plugin-forms/submit.js']);
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
      'route-registry-unread The plugins gatsby-config.js lists are not all written as names or paths, so the functions of local under plugins/ are not read as ways in.',
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
