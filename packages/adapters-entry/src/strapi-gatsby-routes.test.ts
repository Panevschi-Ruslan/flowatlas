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
      "route-registry-unread The routes of src/plugins/built/strapi-server.js are not read: its server entry hands what require('./dist/server') loads at line 1, which is no file there.",
    ]);
  });
});

describe("Strapi plugins shipped only bundled, plugins not installed, controllers written whole (P345)", () => {
  /** A rollup CommonJS build: lazy `requireX()` wrappers in a chunk, the entry handing `getDefaultExportFromCjs(requireServer())` on. */
  const rollup = {
    'node_modules/strapi-plugin-tags/package.json': JSON.stringify({
      name: 'strapi-plugin-tags',
      exports: { './strapi-server': { require: './dist/server/index.js' } },
      strapi: { kind: 'plugin', name: 'tags' },
    }),
    'node_modules/strapi-plugin-tags/dist/server/index.js': [
      "'use strict';",
      "var server = require('./server.js');",
      'var index = /*@__PURE__*/server.getDefaultExportFromCjs(server.requireServer());',
      'module.exports = index;',
    ].join('\n'),
    'node_modules/strapi-plugin-tags/dist/server/server.js': [
      "'use strict';",
      "function getDefaultExportFromCjs (x) { return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x; }",
      'var admin;',
      'var hasRequiredAdmin;',
      'function requireAdmin () {',
      '  if (hasRequiredAdmin) return admin;',
      '  hasRequiredAdmin = 1;',
      "  admin = { type: 'admin', routes: [{ method: 'GET', path: '/settings', handler: 'settings.get' }] };",
      '  return admin;',
      '}',
      'var contentApi = {};',
      'var hasRequiredContentApi;',
      'function requireContentApi () {',
      '  if (hasRequiredContentApi) return contentApi;',
      '  hasRequiredContentApi = 1;',
      "  contentApi.type = 'content-api';",
      "  contentApi.routes = [{ method: 'GET', path: '/tags', handler: 'tag.find' }, { method: 'POST', path: '/tags', handler: 'tag.create' }];",
      '  return contentApi;',
      '}',
      'var routes;',
      'var hasRequiredRoutes;',
      'function requireRoutes () {',
      '  if (hasRequiredRoutes) return routes;',
      '  hasRequiredRoutes = 1;',
      "  routes = { admin: requireAdmin(), 'content-api': requireContentApi() };",
      '  return routes;',
      '}',
      'var server;',
      'var hasRequiredServer;',
      'function requireServer () {',
      '  if (hasRequiredServer) return server;',
      '  hasRequiredServer = 1;',
      '  server = () => ({ routes: requireRoutes(), controllers: {} });',
      '  return server;',
      '}',
      'exports.getDefaultExportFromCjs = getDefaultExportFromCjs;',
      'exports.requireServer = requireServer;',
    ].join('\n'),
  };

  /** An esbuild CommonJS build: `__commonJS` module factories, one writing its exports key by key. */
  const esbuildCommonJs = {
    'node_modules/@shop/strapi-plugin-reports/package.json': JSON.stringify({ name: '@shop/strapi-plugin-reports', main: './strapi-server.js', strapi: { kind: 'plugin', name: 'reports' } }),
    'node_modules/@shop/strapi-plugin-reports/strapi-server.js': [
      '"use strict";',
      'var __getOwnPropNames = Object.getOwnPropertyNames;',
      'var __commonJS = (cb, mod) => function __require() {',
      '  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;',
      '};',
      'var require_list = __commonJS({',
      '  "server/routes/list.js"(exports2, module2) {',
      '    module2.exports = [{ method: "GET", path: "/reports", handler: "report.find" }];',
      '  }',
      '});',
      'var require_routes = __commonJS({',
      '  "server/routes/index.js"(exports2) {',
      '    exports2["content-api"] = { type: "content-api", routes: require_list() };',
      '  }',
      '});',
      'var require_server = __commonJS({',
      '  "server/index.js"(exports2, module2) {',
      '    module2.exports = { routes: require_routes(), controllers: {} };',
      '  }',
      '});',
      'module.exports = require_server();',
    ].join('\n'),
  };

  /** An esbuild build of ES modules: `__esm` initializers and `__export` into the module's exports. */
  const esbuildEsm = {
    'node_modules/strapi-plugin-feeds/package.json': JSON.stringify({ name: 'strapi-plugin-feeds', strapi: { kind: 'plugin', name: 'feeds' } }),
    'node_modules/strapi-plugin-feeds/strapi-server.js': [
      '"use strict";',
      'var __defProp = Object.defineProperty;',
      'var __getOwnPropNames = Object.getOwnPropertyNames;',
      'var __esm = (fn, res) => function __init() { return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res; };',
      'var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };',
      'var __toCommonJS = (mod) => mod;',
      'var routes_default;',
      'var init_routes = __esm({',
      '  "server/src/routes/index.ts"() {',
      '    routes_default = { "content-api": { type: "content-api", routes: [{ method: "GET", path: "/feeds", handler: "feed.find" }] } };',
      '  }',
      '});',
      'var index_exports = {};',
      '__export(index_exports, { default: () => index_default });',
      'module.exports = __toCommonJS(index_exports);',
      'init_routes();',
      'var index_default = { routes: routes_default, controllers: {} };',
    ].join('\n'),
  };

  it("reads an installed plugin shipped only as a rollup or an esbuild bundle through the bundler's module wrappers", () => {
    const read = extract(
      strapiServerAdapter,
      {},
      { ...rollup, ...esbuildCommonJs, ...esbuildEsm },
      { dependencies: { 'strapi-plugin-tags': '1.0.0', '@shop/strapi-plugin-reports': '1.0.0', 'strapi-plugin-feeds': '1.0.0' } },
    );
    expect(routes(read)).toEqual([
      'GET /api/feeds/feeds -> (package)',
      'GET /api/reports/reports -> (package)',
      'GET /api/tags/tags -> (package)',
      'GET /tags/settings -> (package)',
      'POST /api/tags/tags -> (package)',
    ]);
    expect(read.entries.find((entry) => entry.label === 'GET /api/tags/tags')?.meta?.['declaredIn']).toBe('node_modules/strapi-plugin-tags/dist/server/server.js');
    expect(read.unresolved).toEqual([]);
  });

  it('says how far a bundle it cannot read was followed, and where it stopped', () => {
    const read = extract(
      strapiServerAdapter,
      {},
      {
        'node_modules/strapi-plugin-packed/package.json': JSON.stringify({ name: 'strapi-plugin-packed', strapi: { kind: 'plugin', name: 'packed' } }),
        'node_modules/strapi-plugin-packed/strapi-server.js': [
          'var __webpack_modules__ = {};',
          'function __webpack_require__(id) { var module = { exports: {} }; __webpack_modules__[id](module, module.exports, __webpack_require__); return module.exports; }',
          'module.exports = __webpack_require__(12);',
        ].join('\n'),
      },
      { dependencies: { 'strapi-plugin-packed': '1.0.0' } },
    );
    expect(read.entries).toEqual([]);
    expect(read.unresolved.map((row) => `${row.reason} ${row.file} ${row.message}`)).toEqual([
      "route-registry-unread node_modules/strapi-plugin-packed/strapi-server.js The routes of node_modules/strapi-plugin-packed/strapi-server.js are not read: its server entry hands {} at line 2, a bundled build whose module wrappers were followed as far as they are read, which is not an object of the server's keys nor a function returning one.",
    ]);
  });

  it('gives a dependency not installed that the repository says is a Strapi plugin a row, by its name or its lockfile entry', () => {
    const read = extract(
      strapiServerAdapter,
      {},
      {
        'config/plugins.js': "module.exports = {\n  notes: { enabled: false },\n  'users-permissions': { config: { jwt: { expiresIn: '7d' } } },\n};\n",
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            '': { dependencies: {} },
            'node_modules/tagger-kit': { version: '1.0.0', peerDependencies: { '@strapi/strapi': '^5.0.0' } },
            'node_modules/left-pad': { version: '1.3.0' },
          },
        }),
      },
      {
        dependencies: {
          '@strapi/strapi': '5.0.0',
          '@strapi/plugin-users-permissions': '5.0.0',
          '@acme/strapi-plugin-badges': '1.0.0',
          'strapi-plugin-notes': '1.0.0',
          'tagger-kit': '1.0.0',
          'left-pad': '1.3.0',
        },
      },
    );
    expect(read.unresolved.map((row) => `${row.reason} ${row.file} ${row.symbol} ${row.message}`)).toEqual([
      'route-registry-unread package.json badges The routes of the Strapi plugin badges are not read: it is the dependency @acme/strapi-plugin-badges, a Strapi plugin by its name, which is not installed in the repository, so its package\'s server is not there to read.',
      'route-registry-unread package.json tagger-kit The routes of the Strapi plugin tagger-kit are not read: it is the dependency tagger-kit, a Strapi plugin by its package-lock.json entry\'s peer dependency on @strapi/strapi, which is not installed in the repository, so its package\'s server is not there to read.',
      'route-registry-unread package.json users-permissions The routes of the Strapi plugin users-permissions are not read: it is the dependency @strapi/plugin-users-permissions, a Strapi plugin by its name, which is not installed in the repository, so its package\'s server is not there to read.',
    ]);
  });

  it("reads a controller an extension writes whole as the actions it answers, the plugin's own beside them where it spreads them", () => {
    const read = extract(
      strapiServerAdapter,
      {
        'src/plugins/reviews/strapi-server.js': [
          'module.exports = {',
          '  routes: [',
          "    { method: 'GET', path: '/list', handler: 'review.list' },",
          "    { method: 'DELETE', path: '/:id', handler: 'review.remove' },",
          "    { method: 'POST', path: '/flag', handler: 'flag.mark' },",
          "    { method: 'DELETE', path: '/flag', handler: 'flag.clear' },",
          '  ],',
          '  controllers: {',
          '    review: { list: async (ctx) => {}, remove: async (ctx) => {} },',
          '    flag: { mark: async (ctx) => {}, clear: async (ctx) => {} },',
          '  },',
          '};',
        ].join('\n'),
        'src/extensions/reviews/strapi-server.js': [
          'module.exports = (plugin) => {',
          '  const original = plugin.controllers.review;',
          '  plugin.controllers.review = (opts) => ({',
          '    ...original(opts),',
          '    list: async (ctx) => { ctx.body = []; },',
          '  });',
          '  plugin.controllers.flag = { mark: async (ctx) => { ctx.body = {}; } };',
          '  return plugin;',
          '};',
        ].join('\n'),
        'src/extensions/tags/strapi-server.js': [
          'module.exports = (plugin) => {',
          '  plugin.controllers.tag = ({ strapi }) => ({ ...plugin.controllers.tag({ strapi }), create: async (ctx) => { ctx.body = {}; } });',
          '  return plugin;',
          '};',
        ].join('\n'),
      },
      { 'config/plugins.js': "module.exports = {\n  reviews: { enabled: true, resolve: './src/plugins/reviews' },\n};\n", ...rollup },
      { dependencies: { 'strapi-plugin-tags': '1.0.0' } },
    );
    expect(routes(read)).toEqual([
      'DELETE /reviews/:id -> src/plugins/reviews/strapi-server.js:9',
      'DELETE /reviews/flag -> (unread)',
      'GET /api/tags/tags -> (package)',
      'GET /reviews/list -> src/extensions/reviews/strapi-server.js:5',
      'GET /tags/settings -> (package)',
      'POST /api/tags/tags -> src/extensions/tags/strapi-server.js:2',
      'POST /reviews/flag -> src/extensions/reviews/strapi-server.js:7',
    ]);
    expect(read.unresolved.map((row) => `${row.reason} ${row.symbol} ${row.message}`)).toEqual([
      "route-handler-unread flag.clear The handler of DELETE /reviews/flag, flag.clear, is an action of a controller src/extensions/reviews/strapi-server.js writes whole, which neither writes that action nor spreads the plugin's own controller into it, so nothing is read to answer the route.",
    ]);
  });

  /** A webpack 5 build: `__webpack_modules__` keyed by path, CommonJS and ES modules, the entry inlined in the bootstrap. */
  const webpack = {
    'node_modules/strapi-plugin-pins/package.json': JSON.stringify({ name: 'strapi-plugin-pins', strapi: { kind: 'plugin', name: 'pins' } }),
    'node_modules/strapi-plugin-pins/strapi-server.js': [
      '/******/ (() => { // webpackBootstrap',
      '/******/ \tvar __webpack_modules__ = ({',
      '"./server/routes/content-api.js":',
      '((module) => {',
      'module.exports = { type: "content-api", routes: [{ method: "GET", path: "/pins", handler: "pin.find" }] };',
      '}),',
      '"./server/routes/index.js":',
      '((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {',
      '"use strict";',
      '__webpack_require__.r(__webpack_exports__);',
      '__webpack_require__.d(__webpack_exports__, { "default": () => (__WEBPACK_DEFAULT_EXPORT__) });',
      'var _content_api__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__("./server/routes/content-api.js");',
      'var _content_api__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_content_api__WEBPACK_IMPORTED_MODULE_0__);',
      'const __WEBPACK_DEFAULT_EXPORT__ = ({ "content-api": _content_api__WEBPACK_IMPORTED_MODULE_0___default(), admin: { type: "admin", routes: [{ method: "PUT", path: "/settings", handler: "settings.set" }] } });',
      '})',
      '/******/ \t});',
      '/******/ \tvar __webpack_module_cache__ = {};',
      '/******/ \tfunction __webpack_require__(moduleId) {',
      '/******/ \t\tvar cachedModule = __webpack_module_cache__[moduleId];',
      '/******/ \t\tif (cachedModule !== undefined) return cachedModule.exports;',
      '/******/ \t\tvar module = __webpack_module_cache__[moduleId] = { exports: {} };',
      '/******/ \t\t__webpack_modules__[moduleId](module, module.exports, __webpack_require__);',
      '/******/ \t\treturn module.exports;',
      '/******/ \t}',
      'var __webpack_exports__ = {};',
      '(() => {',
      '"use strict";',
      '__webpack_require__.r(__webpack_exports__);',
      '__webpack_require__.d(__webpack_exports__, { "default": () => (__WEBPACK_DEFAULT_EXPORT__) });',
      'var _routes__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__("./server/routes/index.js");',
      'const __WEBPACK_DEFAULT_EXPORT__ = ({ routes: _routes__WEBPACK_IMPORTED_MODULE_0__["default"], controllers: {} });',
      '})();',
      'module.exports = __webpack_exports__;',
      '/******/ })();',
    ].join('\n'),
  };

  /** A webpack 4 build: the modules an array handed to the bootstrap function, each loaded by its place. */
  const webpack4 = {
    'node_modules/strapi-plugin-maps/package.json': JSON.stringify({ name: 'strapi-plugin-maps', strapi: { kind: 'plugin', name: 'maps' } }),
    'node_modules/strapi-plugin-maps/strapi-server.js': [
      'module.exports = (function (modules) {',
      '  var installedModules = {};',
      '  function __webpack_require__(moduleId) {',
      '    var module = installedModules[moduleId] = { i: moduleId, l: false, exports: {} };',
      '    modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);',
      '    return module.exports;',
      '  }',
      '  return __webpack_require__(__webpack_require__.s = 1);',
      '})([',
      '  function (module, exports) {',
      '    exports.routes = [{ method: "GET", path: "/maps", handler: "map.find" }];',
      '    exports.type = "content-api";',
      '  },',
      '  function (module, exports, __webpack_require__) {',
      '    module.exports = { routes: { "content-api": __webpack_require__(0) }, controllers: {} };',
      '  },',
      ']);',
    ].join('\n'),
  };

  it("reads an installed plugin shipped as a webpack bundle through its table of modules (P351)", () => {
    const read = extract(strapiServerAdapter, {}, { ...webpack, ...webpack4 }, { dependencies: { 'strapi-plugin-pins': '1.0.0', 'strapi-plugin-maps': '1.0.0' } });
    expect(read.unresolved).toEqual([]);
    expect(routes(read)).toEqual(['GET /api/maps/maps -> (package)', 'GET /api/pins/pins -> (package)', 'PUT /pins/settings -> (package)']);
  });

  it('merges a dependency not installed into the key of config/plugins that names it otherwise (P351)', () => {
    const read = extract(
      strapiServerAdapter,
      {
        'src/plugins/local-notes/strapi-server.js': "module.exports = { routes: [{ method: 'GET', path: '/notes', handler: 'note.find' }], controllers: { note: { find: async (ctx) => {} } } };",
      },
      {
        'config/plugins.js': [
          'module.exports = {',
          "  'color-kit': { enabled: true, resolve: 'strapi-plugin-colors' },",
          "  notes: { enabled: true, resolve: './src/plugins/local-notes' },",
          '  mapView: { enabled: true },',
          "  'pdf-export': { enabled: true },",
          '};',
        ].join('\n'),
        'src/plugins/local-notes/package.json': JSON.stringify({ name: '@shop/strapi-plugin-notes' }),
      },
      {
        dependencies: {
          'strapi-plugin-colors': '1.0.0',
          '@shop/strapi-plugin-notes': 'file:./src/plugins/local-notes',
          'strapi-plugin-map-view': '1.0.0',
          '@acme/strapi-plugin-printer': '1.0.0',
        },
      },
    );
    expect(routes(read)).toEqual(['GET /notes/notes -> src/plugins/local-notes/strapi-server.js:1']);
    expect(read.unresolved.map((row) => `${row.file} ${row.symbol} ${row.message}`)).toEqual([
      "config/plugins.js color-kit The routes of the Strapi plugin color-kit are not read: config/plugins resolves it from the package strapi-plugin-colors, a Strapi plugin by its name, which is not installed in the repository, so its package's server is not there to read.",
      "config/plugins.js mapView The routes of the Strapi plugin mapView are not read: it is the dependency strapi-plugin-map-view (config/plugins keys it as mapView), a Strapi plugin by its name, which is not installed in the repository, so its package's server is not there to read.",
      'config/plugins.js pdf-export The routes of the Strapi plugin pdf-export are not read: config/plugins enables it, and no package of that name is installed in the repository; the dependency @acme/strapi-plugin-printer (a Strapi plugin by its name), not installed and named by no key, may be it under another name.',
    ]);
  });

  it("reads an extension writing the plugin's controllers whole, keeping the plugin's where it spreads them and dropping them where not (P351)", () => {
    const plugin = (name: string): string =>
      [
        'module.exports = {',
        '  routes: [',
        `    { method: 'GET', path: '/a', handler: 'alpha.list' },`,
        `    { method: 'POST', path: '/a', handler: 'alpha.make' },`,
        `    { method: 'GET', path: '/b', handler: 'beta.list' },`,
        `    { method: 'GET', path: '/c', handler: 'gamma.list' },`,
        '  ],',
        '  controllers: {',
        `    alpha: { list: async (ctx) => { ctx.body = '${name}'; }, make: async (ctx) => {} },`,
        '    beta: { list: async (ctx) => {} },',
        '    gamma: { list: async (ctx) => {} },',
        '  },',
        '};',
      ].join('\n');
    const read = extract(
      strapiServerAdapter,
      {
        'src/plugins/kept/strapi-server.js': plugin('kept'),
        'src/plugins/fresh/strapi-server.js': plugin('fresh'),
        'src/extensions/kept/strapi-server.js': [
          'module.exports = (plugin) => {',
          '  const own = plugin.controllers;',
          '  plugin.controllers = {',
          '    ...own,',
          '    alpha: (opts) => ({ ...own.alpha, list: async (ctx) => { ctx.body = []; } }),',
          '  };',
          '  Object.assign(plugin.controllers, { gamma: { list: async (ctx) => { ctx.body = 1; } } });',
          '  return plugin;',
          '};',
        ].join('\n'),
        'src/extensions/fresh/strapi-server.js': [
          'module.exports = (plugin) => {',
          '  plugin.controllers = {',
          '    alpha: { list: async (ctx) => { ctx.body = []; } },',
          '    beta: plugin.controllers.beta,',
          '  };',
          '  return plugin;',
          '};',
        ].join('\n'),
      },
      { 'config/plugins.js': "module.exports = {\n  kept: { enabled: true, resolve: './src/plugins/kept' },\n  fresh: { enabled: true, resolve: './src/plugins/fresh' },\n};\n" },
    );
    expect(routes(read)).toEqual([
      'GET /fresh/a -> src/extensions/fresh/strapi-server.js:3',
      'GET /fresh/b -> src/plugins/fresh/strapi-server.js:10',
      'GET /fresh/c -> (unread)',
      'GET /kept/a -> src/extensions/kept/strapi-server.js:5',
      'GET /kept/b -> src/plugins/kept/strapi-server.js:10',
      'GET /kept/c -> src/extensions/kept/strapi-server.js:7',
      'POST /fresh/a -> (unread)',
      'POST /kept/a -> src/plugins/kept/strapi-server.js:9',
    ]);
    expect(read.unresolved.map((row) => `${row.symbol} ${row.message}`)).toEqual([
      "alpha.make The handler of POST /fresh/a, alpha.make, is an action of a controller src/extensions/fresh/strapi-server.js writes whole, which neither writes that action nor spreads the plugin's own controller into it, so nothing is read to answer the route.",
      "gamma.list The handler of GET /fresh/c, gamma.list, is an action of a controller src/extensions/fresh/strapi-server.js drops: it writes the plugin's controllers as an object that neither holds that controller nor spreads the plugin's own, so nothing is read to answer the route.",
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
