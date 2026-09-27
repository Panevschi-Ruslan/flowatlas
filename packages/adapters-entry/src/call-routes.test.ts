import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type PackageJson,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  callRoutesAdapter,
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  koaRoutesAdapter,
} from './call-routes.js';
import { EXPRESS, FASTIFY, KOA } from './route-dialects.js';

/**
 * Enough of each framework for the type of a receiver to mean something.
 *
 * Only the shapes the reader matches on. The fixtures hold fuller stubs; what
 * is here is the minimum that makes a call a route, because the one thing these
 * tests are about is which calls are routes and where they are served.
 */
const EXPRESS_TYPES = `
export type NextFunction = (error?: unknown) => void;
export interface Request<P = any, R = any, B = any> { params: P; body: B }
export interface Response { json(body: unknown): Response; send(body?: unknown): Response }
export type RequestHandler = (req: Request, res: Response, next: NextFunction) => unknown;
export interface IRoute {
  get(...handlers: RequestHandler[]): IRoute;
  post(...handlers: RequestHandler[]): IRoute;
  put(...handlers: RequestHandler[]): IRoute;
  all(...handlers: RequestHandler[]): IRoute;
}
export interface IRouter {
  route(path: string): IRoute;
  /** A list of paths is legal on every verb, and declares one route per entry. */
  get(path: string[], ...handlers: RequestHandler[]): this;
  get(path: string, ...handlers: RequestHandler[]): this;
  post(path: string, ...handlers: RequestHandler[]): this;
  delete(path: string, ...handlers: RequestHandler[]): this;
  all(path: string, ...handlers: RequestHandler[]): this;
  use(...handlers: RequestHandler[]): this;
  use(path: string, ...handlers: Array<RequestHandler | IRouter>): this;
}
export interface Router extends IRouter {}
export interface Application extends IRouter {
  get(name: string): unknown;
  get(path: string, ...handlers: RequestHandler[]): this;
  set(name: string, value: unknown): this;
  /** Answers with the application, which is what makes a chained declaration legal. */
  disable(name: string): this;
}
export interface Express extends Application {}
export declare function Router(options?: unknown): Router;
declare function express(): Express;
declare namespace express { function json(): RequestHandler }
export default express;
`;

const FASTIFY_TYPES = `
export interface FastifyRequest<B = any> { params: any; body: B }
export interface FastifyReply { code(status: number): FastifyReply; send(payload?: unknown): FastifyReply }
export type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => unknown;
export interface RouteShorthandOptions { preHandler?: RouteHandler | RouteHandler[] }
export interface RouteOptions extends RouteShorthandOptions { method: string; url: string; handler: RouteHandler }
export interface FastifyInstance {
  get(path: string, handler: RouteHandler): FastifyInstance;
  get(path: string, options: RouteShorthandOptions, handler: RouteHandler): FastifyInstance;
  post(path: string, handler: RouteHandler): FastifyInstance;
  post(path: string, options: RouteShorthandOptions, handler: RouteHandler): FastifyInstance;
  route(options: RouteOptions): FastifyInstance;
  register(plugin: FastifyPluginAsync, options?: { prefix?: string }): FastifyInstance;
  addHook(name: string, hook: RouteHandler): FastifyInstance;
}
export type FastifyPluginAsync = (instance: FastifyInstance, options?: unknown) => Promise<void>;
declare function fastify(): FastifyInstance;
export default fastify;
`;

const KOA_TYPES = `
export interface Context { params: Record<string, string>; body: unknown; status: number }
export type Next = () => Promise<void>;
export type Middleware = (ctx: Context, next: Next) => unknown;
declare class Application { use(middleware: Middleware): Application }
export default Application;
`;

const KOA_ROUTER_TYPES = `
import type { Middleware } from 'koa';
export declare class Router {
  constructor(options?: { prefix?: string });
  get(path: string, ...handlers: Middleware[]): Router;
  post(path: string, ...handlers: Middleware[]): Router;
  del(path: string, ...handlers: Middleware[]): Router;
  use(...handlers: Middleware[]): Router;
  use(path: string, ...handlers: Middleware[]): Router;
  prefix(path: string): Router;
  routes(): Middleware;
  allowedMethods(): Middleware;
}
export default Router;
`;

/**
 * The one mount helper the tool has a record of, as a package.
 *
 * It has to be a package and not a file of the repository, because the record is
 * keyed by the package a helper is imported from: a helper written here would be
 * the undescribed case however its arguments are spelled.
 */
const KOA_MOUNT_TYPES = `
import type Application from 'koa';
import type { Middleware } from 'koa';
declare function mount(path: string, app: Application): Middleware;
declare function mount(app: Application): Middleware;
export default mount;
`;

const PACKAGES: Record<string, Record<string, string>> = {
  express: { express: EXPRESS_TYPES },
  fastify: { fastify: FASTIFY_TYPES },
  koa: { koa: KOA_TYPES, '@koa/router': KOA_ROUTER_TYPES, 'koa-mount': KOA_MOUNT_TYPES },
};

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

/** Reads a repository written in one framework, `/src/main.ts` plus the rest. */
const readWith = (
  adapter: { extractEntries(ctx: ExtractContext): EntryNode[] },
  stubs: Record<string, string>,
  dependencies: PackageJson['dependencies'],
  main: string,
  files: Record<string, string> = {},
): Read => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [name, source] of Object.entries(stubs)) {
    project.createSourceFile(`/node_modules/${name}/package.json`, '{"types":"index.d.ts"}');
    project.createSourceFile(`/node_modules/${name}/index.d.ts`, source);
  }
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  project.createSourceFile('/src/main.ts', main);

  const ctx: ExtractContext = {
    repo: 'api',
    repoDir: '/',
    service: { name: 'api', repo: '/', type: 'express' },
    config: parseConfig({}),
    pkg: { dependencies },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return { entries: adapter.extractEntries(ctx), unresolved: ctx.builder.build().unresolved };
};

const express = (main: string, files?: Record<string, string>): Read =>
  readWith(expressRoutesAdapter, PACKAGES['express'] as Record<string, string>, { express: '^4.0.0' }, main, files);

const fastify = (main: string, files?: Record<string, string>): Read =>
  readWith(fastifyRoutesAdapter, PACKAGES['fastify'] as Record<string, string>, { fastify: '^5.0.0' }, main, files);

const koa = (main: string, files?: Record<string, string>): Read =>
  readWith(koaRoutesAdapter, PACKAGES['koa'] as Record<string, string>, { koa: '^2.0.0' }, main, files);

const ids = (read: Read): string[] => read.entries.map((entry) => entry.id).sort();

const middlewareOf = (read: Read, id: string): string[] =>
  (read.entries.find((entry) => entry.id === id)?.wrapping ?? [])
    .filter((one) => one.layer === 'middleware')
    .map((one) => one.label);

const reasons = (read: Read): string[] => read.unresolved.map((row) => row.reason);

describe('one reader, described per framework', () => {
  it('runs where the framework it describes is a dependency, and not otherwise', () => {
    expect(expressRoutesAdapter.detect({ dependencies: { express: '^4.0.0' } })).toBe(true);
    expect(expressRoutesAdapter.detect({ dependencies: { fastify: '^5.0.0' } })).toBe(false);
    expect(fastifyRoutesAdapter.detect({ dependencies: { fastify: '^5.0.0' } })).toBe(true);
    expect(koaRoutesAdapter.detect({ dependencies: { '@koa/router': '^13.0.0' } })).toBe(true);
  });

  it('names each adapter after the framework whose row it was built from', () => {
    expect(callRoutesAdapter(EXPRESS).name).toBe('express-routes');
    expect(callRoutesAdapter(FASTIFY).name).toBe('fastify-routes');
    expect(callRoutesAdapter(KOA).name).toBe('koa-routes');
  });
});

describe('express routes', () => {
  it('records the verb and the path as declared', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      app.get('/health', (req, res) => res.send('ok'));
      app.post('/orders/:orderId/cancel', (req, res) => res.send('ok'));
    `);
    expect(ids(read)).toEqual([
      'entry:api:http:GET:/health',
      'entry:api:http:POST:/orders/:param/cancel',
    ]);
  });

  it('reads a route whose path is declared on the chain rather than on the call', () => {
    // `app.route('/books')` hands back an `IRoute`, which is a type no row here
    // names, so every verb written on it used to be read as nothing at all —
    // silently, which is the failure worth fixing. The path is on the chain and
    // the verbs are on the route object, and one chain declares as many routes
    // as it has verbs.
    const read = express(`
      import express from 'express';
      import { list, create } from './books.js';
      const app = express();
      app.route('/books').get(list).post(create);
    `, {
      '/src/books.ts': `
        import type { Request, Response } from 'express';
        export const list = (req: Request, res: Response) => res.json([]);
        export const create = (req: Request, res: Response) => res.json({});
      `,
    });
    expect(ids(read)).toEqual(['entry:api:http:GET:/books', 'entry:api:http:POST:/books']);
    expect(read.unresolved).toEqual([]);
    const entry = read.entries.find((candidate) => candidate.id === 'entry:api:http:GET:/books');
    // Said as it is written. The reader rewrites the chain into the positional
    // form to read it, and the entry must not go on to claim the source says
    // something it does not.
    expect(entry?.meta?.['registration']).toBe("app.route('/books').get");
    expect(entry?.handler).toBeDefined();
  });

  it('puts what a chained route is mounted under, and installed behind, in front of it', () => {
    const read = express(`
      import express, { Router } from 'express';
      import { authenticate } from './auth.js';
      import { list } from './books.js';
      const app = express();
      const books = Router();
      books.route('/:isbn').get(list);
      app.use(authenticate);
      app.use('/library', books);
    `, {
      '/src/auth.ts': `
        import type { Request, Response, NextFunction } from 'express';
        export const authenticate = (req: Request, res: Response, next: NextFunction) => next();
      `,
      '/src/books.ts': `
        import type { Request, Response } from 'express';
        export const list = (req: Request, res: Response) => res.json([]);
      `,
    });
    expect(ids(read)).toEqual(['entry:api:http:GET:/library/:param']);
    expect(middlewareOf(read, 'entry:api:http:GET:/library/:param')).toEqual(['authenticate']);
  });

  it('says so when the path on the chain is assembled at run time', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      const pathFor = (name: string) => '/' + name;
      app.route(pathFor('books')).get((req, res) => res.json([]));
    `);
    expect(read.entries).toEqual([]);
    // And that it read no route at all, which is the second row: a reader that
    // came away with nothing says so, whatever the reason for each site (R84).
    expect(reasons(read).sort()).toEqual(['entry-http-routes-unmatched', 'route-path-dynamic']);
  });

  it('reads an application declared by a chain of calls', () => {
    const read = express(`
      import express, { Router } from 'express';
      import { list } from './books.js';
      const app = express().disable('x-powered-by');
      const books = Router();
      books.get('/books', list);
      app.use('/api/v1', books);
      app.get('/health', (req, res) => res.send('ok'));
    `, {
      '/src/books.ts': `
        import type { Request, Response } from 'express';
        export const list = (req: Request, res: Response) => res.json([]);
      `,
    });
    // `express().disable(…)` hands the application back, so this is the ordinary
    // declaration of one with a setting turned off. The reader followed only the
    // methods a row names, so `app` had no base it could tell and every route in
    // the repository was reported as unplaceable — 344 of them on PeerTube, from
    // one line written once (R101).
    expect(ids(read)).toEqual(['entry:api:http:GET:/api/v1/books', 'entry:api:http:GET:/health']);
    expect(read.unresolved).toEqual([]);
  });

  it('records one route for each path a registration was given', () => {
    const read = express(`
      import express, { Router } from 'express';
      import { show, list } from './items.js';
      const app = express();
      const items = Router();
      const LEGACY = ['/legacy/items', '/old/items'];
      items.get(['/items/:id', '/i/:id'], show);
      items.get(LEGACY, list);
      app.use('/api', items);
    `, {
      '/src/items.ts': `
        import type { Request, Response } from 'express';
        export const show = (req: Request, res: Response) => res.json({});
        export const list = (req: Request, res: Response) => res.json([]);
      `,
    });
    // A list of verbs has been folded since the day verbs were read; a list of
    // paths was read by a function that answered with one string or with
    // nothing, so both addresses went missing under a row saying the path was
    // dynamic. Written as a literal or named elsewhere, both fold (R101).
    expect(ids(read)).toEqual([
      'entry:api:http:GET:/api/i/:param',
      'entry:api:http:GET:/api/items/:param',
      'entry:api:http:GET:/api/legacy/items',
      'entry:api:http:GET:/api/old/items',
    ]);
    expect(read.unresolved).toEqual([]);
  });

  it('reads a setting rather than a route when only one argument is given', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      app.set('trust proxy', true);
      const mode = app.get('env');
    `);
    expect(read.entries).toEqual([]);
    // No row about a route, because neither line is one. The row that is here is
    // the reader saying it read nothing: these calls are written on a type it
    // does know, so the silence is reported against the verbs rather than the
    // types, and it is informational because a repository can legitimately
    // depend on Express and declare nothing.
    expect(reasons(read)).toEqual(['entry-http-routes-unmatched']);
    expect(read.unresolved[0]?.level).toBe('info');
  });

  it('serves a mounted router a level down, through a default export', () => {
    const read = express(
      `
      import express from 'express';
      import ordersRouter from './orders.js';
      const app = express();
      app.use('/orders', ordersRouter);
    `,
      {
        '/src/orders.ts': `
          import { Router } from 'express';
          const router = Router();
          router.get('/:orderId', (req, res) => res.send('ok'));
          export default router;
        `,
      },
    );
    expect(ids(read)).toEqual(['entry:api:http:GET:/orders/:param']);
  });

  it('puts the middleware installed above a mount in front of every route under it', () => {
    const read = express(
      `
      import express from 'express';
      import { authenticate } from './auth.js';
      import publicRouter from './public.js';
      import ordersRouter from './orders.js';
      const app = express();
      app.use('/public', publicRouter);
      app.use(authenticate);
      app.use('/orders', ordersRouter);
    `,
      {
        '/src/auth.ts':
          "import type { RequestHandler } from 'express';\nexport const authenticate: RequestHandler = (req, res, next) => next();",
        '/src/public.ts': `
          import { Router } from 'express';
          const router = Router();
          router.get('/health', (req, res) => res.send('ok'));
          export default router;
        `,
        '/src/orders.ts': `
          import { Router } from 'express';
          const router = Router();
          router.get('/', (req, res) => res.send('ok'));
          export default router;
        `,
      },
    );
    expect(middlewareOf(read, 'entry:api:http:GET:/orders')).toEqual(['authenticate']);
    expect(middlewareOf(read, 'entry:api:http:GET:/public/health')).toEqual([]);
  });

  it('puts middleware installed on a router in front of the routes declared after it', () => {
    const read = express(`
      import express, { Router } from 'express';
      import { withTenant } from './tenant.js';
      const router = Router();
      router.get('/first', (req, res) => res.send('ok'));
      router.use(withTenant);
      router.get('/second', (req, res) => res.send('ok'));
      const app = express();
      app.use(router);
    `, {
      '/src/tenant.ts':
        "import type { RequestHandler } from 'express';\nexport const withTenant: RequestHandler = (req, res, next) => next();",
    });
    expect(middlewareOf(read, 'entry:api:http:GET:/first')).toEqual([]);
    expect(middlewareOf(read, 'entry:api:http:GET:/second')).toEqual(['withTenant']);
  });

  it('keeps middleware scoped to a path off the routes that path does not cover', () => {
    const read = express(`
      import express, { Router } from 'express';
      import { onlyAdmin } from './admin.js';
      const app = express();
      app.use('/admin', onlyAdmin);
      app.get('/admin/users', (req, res) => res.send('ok'));
      app.get('/orders', (req, res) => res.send('ok'));
    `, {
      '/src/admin.ts':
        "import type { RequestHandler } from 'express';\nexport const onlyAdmin: RequestHandler = (req, res, next) => next();",
    });
    expect(middlewareOf(read, 'entry:api:http:GET:/admin/users')).toEqual(['onlyAdmin']);
    expect(middlewareOf(read, 'entry:api:http:GET:/orders')).toEqual([]);
  });

  it('reads the function a wrapper is given rather than stopping at the wrapper', () => {
    const read = express(`
      import express from 'express';
      import asyncHandler from './async.js';
      const app = express();
      app.get('/orders', asyncHandler(async (req, res) => res.send('ok')));
    `, {
      '/src/async.ts':
        "import type { RequestHandler } from 'express';\nexport default (fn: RequestHandler): RequestHandler => fn;",
    });
    const [entry] = read.entries;
    expect(entry?.meta?.['handlerVia']).toBe('inline');
    expect(entry?.handler).toBeDefined();
  });

  // PeerTube's shape, 291 of its 346 registrations (R137).
  it('reads a named function a wrapper is given as the handler', () => {
    const read = express(`
      import express from 'express';
      import asyncHandler from './async.js';
      const app = express();
      app.get('/orders', asyncHandler(listOrders));
      async function listOrders(req, res) { return res.send('ok'); }
    `, {
      '/src/async.ts':
        "import type { RequestHandler } from 'express';\nexport default (fn: RequestHandler): RequestHandler => fn;",
    });
    const [entry] = read.entries;
    expect(entry?.meta?.['handlerVia']).toBe('function');
    expect(entry?.handler).toMatchObject({ functionName: 'listOrders' });
    expect(reasons(read)).not.toContain('route-handler-anonymous');
  });

  it('reads a handler a factory of this repository built as that factory', () => {
    const read = express(`
      import express from 'express';
      import asyncHandler from './async.js';
      const app = express();
      app.get('/likes', asyncHandler(rateFactory('like')));
      function rateFactory(kind: string) { return async (req, res) => res.send(kind); }
    `, {
      '/src/async.ts':
        "import type { RequestHandler } from 'express';\nexport default (fn: RequestHandler): RequestHandler => fn;",
    });
    const [entry] = read.entries;
    expect(entry?.meta?.['handlerVia']).toBe('call');
    expect(entry?.handler).toMatchObject({ functionName: 'rateFactory' });
  });

  it('does not take a function a factory inside the wrapper was handed as the handler', () => {
    const read = express(`
      import express from 'express';
      import asyncHandler from './async.js';
      const app = express();
      app.get('/lists', asyncHandler(listFactory((req) => req.params.id)));
      function listFactory(ownerOf: (req: any) => string) { return async (req, res) => res.send(ownerOf(req)); }
    `, {
      '/src/async.ts':
        "import type { RequestHandler } from 'express';\nexport default (fn: RequestHandler): RequestHandler => fn;",
    });
    const [entry] = read.entries;
    expect(entry?.handler).toBeUndefined();
    expect(reasons(read)).toContain('route-handler-anonymous');
  });

  it('points at nothing when a wrapper is handed a list to run in turn', () => {
    const read = express(`
      import express from 'express';
      import asyncHandler from './async.js';
      const app = express();
      app.post('/batch', asyncHandler([check, run]));
      async function check(req, res, next) { next(); }
      async function run(req, res) { return res.send('ok'); }
    `, {
      '/src/async.ts':
        "import type { RequestHandler } from 'express';\nexport default (fn: RequestHandler | RequestHandler[]): RequestHandler => fn as RequestHandler;",
    });
    const [entry] = read.entries;
    expect(entry?.handler).toBeUndefined();
    expect(reasons(read)).toContain('route-handler-anonymous');
  });

  it('follows a router built and handed back by a factory', () => {
    const read = express(
      `
      import express from 'express';
      import { createProviderRouter } from './provider.js';
      const app = express();
      app.use('/login/local', createProviderRouter());
    `,
      {
        '/src/provider.ts': `
          import { Router } from 'express';
          export const createProviderRouter = () => {
            const router = Router();
            router.post('/callback', (req, res) => res.send('ok'));
            return router;
          };
        `,
      },
    );
    expect(ids(read)).toEqual(['entry:api:http:POST:/login/local/callback']);
  });

  it('refuses a router whose mount path is built at run time rather than guessing', () => {
    const read = express(
      `
      import express from 'express';
      import ordersRouter from './orders.js';
      const prefix = process.env['PREFIX'];
      const app = express();
      app.use(prefix + '/orders', ordersRouter);
    `,
      {
        '/src/orders.ts': `
          import { Router } from 'express';
          const router = Router();
          router.get('/', (req, res) => res.send('ok'));
          export default router;
        `,
      },
    );
    expect(read.entries).toEqual([]);
    // `entry-http-routes-unplaced` and not `entry-http-routes-unmatched`: the one
    // route here did spell a verb and a path, and the older row said none of them
    // had, which was the reader misreporting its own reading (R121).
    expect(reasons(read).sort()).toEqual(['entry-http-routes-unplaced', 'route-mount-unread']);
  });

  it('says so when the path of a route is assembled at run time', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      const pathFor = (name: string) => '/' + name;
      app.get(pathFor('stats'), (req, res) => res.send('ok'));
    `);
    expect(read.entries).toEqual([]);
    expect(reasons(read).sort()).toEqual(['entry-http-routes-unmatched', 'route-path-dynamic']);
  });

  it('marks a route registered under a condition as one', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      if (process.env['METRICS'] === '1') {
        app.get('/metrics', (req, res) => res.send('ok'));
      }
      app.get('/health', (req, res) => res.send('ok'));
    `);
    expect(read.entries.find((entry) => entry.label === 'GET /metrics')?.meta?.['conditional']).toBe(
      true,
    );
    expect(read.entries.find((entry) => entry.label === 'GET /health')?.meta?.['conditional']).toBe(
      undefined,
    );
  });
});

describe('fastify routes', () => {
  it('serves a plugin under the prefix it is registered with', () => {
    const read = fastify(
      `
      import fastify from 'fastify';
      import { ordersRoutes } from './orders.js';
      const app = fastify();
      app.register(ordersRoutes, { prefix: '/orders' });
    `,
      {
        '/src/orders.ts': `
          import type { FastifyPluginAsync } from 'fastify';
          export const ordersRoutes: FastifyPluginAsync = async (app) => {
            app.get('/:orderId', async (request, reply) => reply.send('ok'));
          };
        `,
      },
    );
    expect(ids(read)).toEqual(['entry:api:http:GET:/orders/:param']);
  });

  it('reads a route written as one object', () => {
    const read = fastify(`
      import fastify from 'fastify';
      const app = fastify();
      app.route({ method: 'DELETE', url: '/orders/:orderId', handler: async (request, reply) => reply.send('ok') });
    `);
    expect(ids(read)).toEqual(['entry:api:http:DELETE:/orders/:param']);
  });

  it('reads middleware from the keys of an options object, and a hook as an install', () => {
    const read = fastify(
      `
      import fastify from 'fastify';
      import { authenticate, requireAdmin } from './hooks.js';
      const app = fastify();
      app.addHook('onRequest', authenticate);
      app.post('/orders', { preHandler: [requireAdmin] }, async (request, reply) => reply.send('ok'));
    `,
      {
        '/src/hooks.ts': `
          import type { RouteHandler } from 'fastify';
          export const authenticate: RouteHandler = async () => undefined;
          export const requireAdmin: RouteHandler = async () => undefined;
        `,
      },
    );
    expect(middlewareOf(read, 'entry:api:http:POST:/orders')).toEqual([
      'authenticate',
      'requireAdmin',
    ]);
  });

  it('refuses the routes of a plugin registered in a way it cannot follow', () => {
    const read = fastify(
      `
      import fastify from 'fastify';
      import autoload from './autoload.js';
      import { ordersRoutes } from './orders.js';
      const app = fastify();
      app.register(autoload, { prefix: '/api' });
      app.register(ordersRoutes);
    `,
      {
        '/src/autoload.ts': "export default 0 as unknown as import('fastify').FastifyPluginAsync;",
        '/src/orders.ts': `
          import type { FastifyPluginAsync } from 'fastify';
          export const ordersRoutes: FastifyPluginAsync = async (app) => {
            app.get('/orders', async (request, reply) => reply.send('ok'));
          };
        `,
      },
    );
    expect(ids(read)).toEqual(['entry:api:http:GET:/orders']);
  });
});

describe('koa routes', () => {
  it('takes the prefix from the router the constructor was given', () => {
    const read = koa(`
      import Router from '@koa/router';
      const router = new Router({ prefix: '/orders' });
      router.get('/:orderId', async (ctx) => { ctx.body = 'ok'; });
      router.del('/:orderId', async (ctx) => { ctx.status = 204; });
    `);
    expect(ids(read)).toEqual([
      'entry:api:http:DELETE:/orders/:param',
      'entry:api:http:GET:/orders/:param',
    ]);
  });

  it('puts the middleware installed on the application in front of the routers below it', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import { authenticate } from './auth.js';
      import { publicRouter } from './public.js';
      import { ordersRouter } from './orders.js';
      const app = new Koa();
      app.use(publicRouter.routes()).use(publicRouter.allowedMethods());
      app.use(authenticate);
      app.use(ordersRouter.routes()).use(ordersRouter.allowedMethods());
    `,
      {
        '/src/auth.ts':
          "import type { Middleware } from 'koa';\nexport const authenticate: Middleware = async () => undefined;",
        '/src/public.ts': `
          import Router from '@koa/router';
          export const publicRouter = new Router({ prefix: '/public' });
          publicRouter.get('/health', async (ctx) => { ctx.body = 'ok'; });
        `,
        '/src/orders.ts': `
          import Router from '@koa/router';
          export const ordersRouter = new Router({ prefix: '/orders' });
          ordersRouter.get('/', async (ctx) => { ctx.body = 'ok'; });
        `,
      },
    );
    expect(middlewareOf(read, 'entry:api:http:GET:/orders')).toEqual(['authenticate']);
    expect(middlewareOf(read, 'entry:api:http:GET:/public/health')).toEqual([]);
  });

  it('moves every route on a router whose prefix is set by a call', () => {
    const read = koa(`
      import Router from '@koa/router';
      const router = new Router();
      router.prefix('/orders');
      router.get('/:orderId', async (ctx) => { ctx.body = 'ok'; });
    `);
    expect(ids(read)).toEqual(['entry:api:http:GET:/orders/:param']);
  });

  it('reports a route under a mount through a helper nobody described, and names the helper', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import { mount } from './mount.js';
      import { api } from './api.js';
      const app = new Koa();
      app.use(mount('/api', api));
    `,
      {
        '/src/mount.ts': `
          import type Application from 'koa';
          import type { Middleware } from 'koa';
          export const mount = (at: string, app: Application): Middleware => async () => undefined;
        `,
        '/src/api.ts': `
          import Koa from 'koa';
          import Router from '@koa/router';
          const router = new Router();
          router.post('/documents.info', async (ctx) => { ctx.body = 'ok'; });
          export const api = new Koa();
          api.use(router.routes());
        `,
      },
    );
    // Not `POST /documents.info`, which is where the route is written and not
    // where it is served: the prefix is inside the helper's arguments under the
    // helper's own meaning, and a wrong address joins to callers that do not
    // exist. So the route is reported instead (R84).
    expect(ids(read)).toEqual([]);
    const row = read.unresolved.find((item) => item.reason === 'route-mount-unread');
    expect(row?.message).toContain('mounted somewhere this cannot read');
    expect(row?.symbol).toBe('POST /documents.info');
    // Its own reason: the route's own path was read, and `route-path-dynamic`
    // says it was not, which is a different fact a user may silence separately.
    expect(read.unresolved.filter((item) => item.reason === 'route-path-dynamic')).toEqual([]);
    // And the hint names the call the path is inside. It used to ask for the
    // application to be mounted at a literal path, which is exactly what this
    // repository has done: the path is `'/api'`, one argument along (R110).
    expect(row?.hint).toContain("mount('/api', api)");
  });

  it('reads the prefix of a mount helper it has a record of', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import mount from 'koa-mount';
      import { api } from './api.js';
      const app = new Koa();
      app.use(mount('/api', api));
    `,
      {
        '/src/api.ts': `
          import Koa from 'koa';
          import Router from '@koa/router';
          const router = new Router();
          router.post('/documents.info', async (ctx) => { ctx.body = 'ok'; });
          export const api = new Koa();
          api.use(router.routes());
        `,
      },
    );
    // The same repository as the test above with one thing changed: the helper
    // comes from a package `MOUNT_HELPERS` has a record of, so which argument is
    // the prefix is known and the address is read rather than reported.
    expect(ids(read)).toEqual(['entry:api:http:POST:/api/documents.info']);
    expect(read.unresolved.filter((row) => row.reason === 'route-mount-unread')).toEqual([]);
  });

  it('reads the application a parameter is given as its default', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import mount from 'koa-mount';
      import { api } from './api.js';
      export default function init(app: Koa = new Koa()) {
        app.use(mount('/api', api));
        return app;
      }
    `,
      {
        '/src/api.ts': `
          import Koa from 'koa';
          import Router from '@koa/router';
          const router = new Router();
          router.post('/documents.info', async (ctx) => { ctx.body = 'ok'; });
          export const api = new Koa();
          api.use(router.routes());
        `,
      },
    );
    // outline's shape exactly: the service is started through a map of dynamic
    // imports, so no call to `init` can be followed, and the default is the only
    // statement in the repository about what `app` is. Reading the prefix and not
    // the parameter leaves the route as unplaceable as it was before (R110).
    expect(ids(read)).toEqual(['entry:api:http:POST:/api/documents.info']);
  });

  it('mounts an application a described helper is handed alone at its parent base', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import mount from 'koa-mount';
      import { api } from './api.js';
      const app = new Koa();
      app.use(mount(api));
    `,
      {
        '/src/api.ts': `
          import Koa from 'koa';
          import Router from '@koa/router';
          const router = new Router();
          router.post('/documents.info', async (ctx) => { ctx.body = 'ok'; });
          export const api = new Koa();
          api.use(router.routes());
        `,
      },
    );
    // `mount(routes)`, which outline writes beside four that name a prefix. The
    // application standing in the prefix's position is the answer rather than an
    // absence: the helper serves it at the base of what it is installed on.
    expect(ids(read)).toEqual(['entry:api:http:POST:/documents.info']);
  });

  it('does not read a helper handed the application it is installed on as a mount', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import Router from '@koa/router';
      import { session } from './session.js';
      const app = new Koa();
      const router = new Router({ prefix: '/orders' });
      router.get('/', async (ctx) => { ctx.body = 'ok'; });
      app.use(session(app));
      app.use(router.routes());
    `,
      {
        '/src/session.ts': `
          import type Application from 'koa';
          import type { Middleware } from 'koa';
          export const session = (app: Application): Middleware => async () => undefined;
        `,
      },
    );
    // `session(app)` hands a factory the very application it is installed on,
    // which mounts nothing. Reading it as a mount would leave every route in the
    // repository with no readable address.
    expect(ids(read)).toEqual(['entry:api:http:GET:/orders']);
  });
});

/**
 * A way in registered once, over a collection.
 *
 * Written against Koa because that is the framework the shape was measured on —
 * outline mounts every plugin's API router with one line — and the mechanism is
 * not Koa's: it is a list nobody can enumerate without following where the list
 * came from (R121).
 */
describe('a registry of applications, mounted whole', () => {
  const REGISTRY = `
    import type Router from '@koa/router';
    export interface Hook { type: string; value: Router }
    export class Registry {
      private static held: Hook[] = [];
      static add(hooks: Hook[]) { Registry.held.push(...hooks); }
      static hooks(type: string): Hook[] { return Registry.held.filter((h) => h.type === type); }
    }
  `;

  const PASSKEYS = `
    import Router from '@koa/router';
    import { Registry } from '../registry.js';
    const api = new Router();
    api.post('passkeys.list', async (ctx) => { ctx.body = 'ok'; });
    Registry.add([{ type: 'api', value: api }]);
  `;

  it('mounts every application a registry holds, rather than none of them', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import Router from '@koa/router';
      import { Registry } from './registry.js';
      import './plugins/passkeys.js';
      const app = new Koa();
      const router = new Router();
      Registry.hooks('api').forEach((hook) => router.use('/', hook.value.routes()));
      app.use('/api', router.routes());
    `,
      { '/src/registry.ts': REGISTRY, '/src/plugins/passkeys.ts': PASSKEYS },
    );
    // Not `POST /passkeys.list`, which is where it is written and also what a
    // reader that never followed the registry would record: the router is
    // mounted on one that answers under `/api`, so that is the address.
    expect(ids(read)).toEqual(['entry:api:http:POST:/api/passkeys.list']);
    expect(reasons(read)).toEqual([]);
  });

  it('carries the prefix of the mount that installed them into every member', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import Router from '@koa/router';
      import { Registry } from './registry.js';
      import './plugins/passkeys.js';
      const app = new Koa();
      const router = new Router();
      for (const hook of Registry.hooks('api')) {
        router.use('/', hook.value.routes());
      }
      app.use('/api', router.routes());
    `,
      { '/src/registry.ts': REGISTRY, '/src/plugins/passkeys.ts': PASSKEYS },
    );
    // The whole point of following the registry, and the second spelling of the
    // iteration: `/api` is what makes a request a browser writes to
    // `/api/passkeys.list` join to the route that answers it.
    expect(ids(read)).toEqual(['entry:api:http:POST:/api/passkeys.list']);
  });

  it('reads a registry behind a getter, by the keys the mount itself reads', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import Router from '@koa/router';
      import { Providers } from './providers.js';
      import './plugins/google.js';
      const app = new Koa();
      const router = new Router();
      void (async () => {
        for (const provider of Providers.all) {
          const resolved = await provider.value.router;
          router.use('/', resolved.routes());
        }
      })();
      app.use('/auth', router.routes());
    `,
      {
        '/src/providers.ts': `
          import type Router from '@koa/router';
          export interface Hook { type: string; value: { router: Router; id: string } }
          export class Registry {
            private static held: Hook[] = [];
            static add(hooks: Hook[]) { Registry.held.push(...hooks); }
            static hooks(type: string): Hook[] { return Registry.held.filter((h) => h.type === type); }
          }
          export class Providers {
            static get all(): Hook[] { return Registry.hooks('auth'); }
          }
        `,
        '/src/plugins/google.ts': `
          import Router from '@koa/router';
          import { Registry } from '../providers.js';
          const router = new Router();
          router.get('/google', async (ctx) => { ctx.body = 'ok'; });
          Registry.add([{ type: 'auth', value: { router, id: 'google' } }]);
        `,
      },
    );
    // Two hops a real repository does not let anybody skip: the collection is
    // behind a getter, and the member is awaited into a name of its own before it
    // is mounted. The keys `provider.value.router` are also what keeps this
    // registry's routers apart from ones held at `hook.value` in the same map.
    expect(ids(read)).toEqual(['entry:api:http:GET:/auth/google']);
  });

  it('leaves one row naming the registry and the mount where members cannot be followed', () => {
    const read = koa(
      `
      import Koa from 'koa';
      import Router from '@koa/router';
      import { hooks } from 'plugin-host';
      const app = new Koa();
      const router = new Router();
      hooks('api').forEach((hook) => router.use('/', hook.value.routes()));
      app.use('/api', router.routes());
    `,
      {
        '/node_modules/plugin-host/package.json': '{"types":"index.d.ts"}',
        '/node_modules/plugin-host/index.d.ts': `
          import type Router from '@koa/router';
          export declare function hooks(type: string): Array<{ type: string; value: Router }>;
        `,
      },
    );
    // Nothing here puts an application into that collection, so there is nothing
    // to place — and one row saying which collection and which mount, not one per
    // member of a list nobody can enumerate.
    const rows = read.unresolved.filter((row) => row.reason === 'route-registry-unread');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain("mounts every application in hooks('api').value at /");
    expect(rows[0]?.symbol).toBe("hooks('api').value");
  });
});

describe('a partial read does not buy silence', () => {
  it('says how many of the routes it read it could place', () => {
    const read = express(
      `
      import express from 'express';
      import ordersRouter from './orders.js';
      import healthRouter from './health.js';
      const prefix = process.env['PREFIX'];
      const app = express();
      app.use(prefix + '/orders', ordersRouter);
      app.use('/health', healthRouter);
    `,
      {
        '/src/orders.ts': `
          import { Router } from 'express';
          const router = Router();
          router.get('/', (req, res) => res.send('ok'));
          router.post('/', (req, res) => res.send('ok'));
          export default router;
        `,
        '/src/health.ts': `
          import { Router } from 'express';
          const router = Router();
          router.get('/', (req, res) => res.send('ok'));
          export default router;
        `,
      },
    );
    // One address placed and two not. The row that says so used to be written
    // only when the count was zero, so a repository read this way looked exactly
    // like a repository with one route (R91).
    expect(ids(read)).toEqual(['entry:api:http:GET:/health']);
    const row = read.unresolved.find((item) => item.reason === 'entry-http-routes-unplaced');
    expect(row?.message).toContain('1 of 3 routes');
    expect(row?.message).toContain('the other 2 could not');
    expect(row?.level).toBe('info');
  });

  it('says nothing where every route it read was placed', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      app.get('/health', (req, res) => res.send('ok'));
    `);
    expect(reasons(read)).toEqual([]);
  });
});
