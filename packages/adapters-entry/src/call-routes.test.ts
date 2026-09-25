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
export interface IRouter {
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

const PACKAGES: Record<string, Record<string, string>> = {
  express: { express: EXPRESS_TYPES },
  fastify: { fastify: FASTIFY_TYPES },
  koa: { koa: KOA_TYPES, '@koa/router': KOA_ROUTER_TYPES },
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
  (read.entries.find((entry) => entry.id === id)?.meta?.['middleware'] as string[] | undefined) ?? [];

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

  it('reads a setting rather than a route when only one argument is given', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      app.set('trust proxy', true);
      const mode = app.get('env');
    `);
    expect(read.entries).toEqual([]);
    expect(read.unresolved).toEqual([]);
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
    expect(reasons(read)).toEqual(['route-path-dynamic']);
  });

  it('says so when the path of a route is assembled at run time', () => {
    const read = express(`
      import express from 'express';
      const app = express();
      const pathFor = (name: string) => '/' + name;
      app.get(pathFor('stats'), (req, res) => res.send('ok'));
    `);
    expect(read.entries).toEqual([]);
    expect(reasons(read)).toEqual(['route-path-dynamic']);
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
});
