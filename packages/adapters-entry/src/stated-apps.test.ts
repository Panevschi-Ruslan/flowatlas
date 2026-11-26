import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  honoRoutesAdapter,
  koaRoutesAdapter,
} from './call-routes.js';

/**
 * Every repository here is a fresh clone: no `node_modules` at all, so no import
 * of a framework resolves and every application is `any` to the checker. What
 * is read is what the source states (R142).
 */
const read = (
  adapter: { extractEntries(ctx: ExtractContext): EntryNode[] },
  main: string,
  files: Record<string, string> = {},
  stubs: Record<string, string> = {},
): EntryNode[] => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, allowJs: true } });
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
    pkg: { dependencies: {} },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return adapter.extractEntries(ctx);
};

const labels = (entries: EntryNode[]): string[] => entries.map((entry) => entry.label).sort();

describe('an application recognised from the source when its type is not installed', () => {
  it('reads express() and express.Router(), mounted, as surely as their types would (P346)', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express from 'express';
       import { users } from './users';
       const app = express();
       app.use('/api', users);
       app.get('/health', (_req, res) => res.send('ok'));
       app.get('trust proxy');`,
      {
        '/src/users.ts': `import express from 'express';
          export const users = express.Router();
          users.post('/users', (_req, res) => res.send('ok'));`,
      },
    );
    expect(labels(entries)).toEqual(['GET /health', 'POST /api/users']);
    expect(entries.every((entry) => entry.meta?.['confidence'] === undefined)).toBe(true);
  });

  it('reads an annotation, an aliased import and a class of the repository extending Router', () => {
    const entries = read(
      expressRoutesAdapter,
      `import { Router as ExpressRouter } from 'express';
       import type { Express } from 'express';
       class ApiRouter extends ExpressRouter {}
       const api = new ApiRouter();
       api.get('/a', (_req, res) => res.send('ok'));
       export function install(app: Express) {
         app.get('/b', (_req, res) => res.send('ok'));
       }`,
    );
    expect(labels(entries)).toEqual(['GET /a', 'GET /b']);
  });

  it('reads a router destructured out of an options object whose type is written', () => {
    // A video platform's `setupUploadResumableRoutes`, the one file its fresh clone still
    // left unread once applications were recognised from the source.
    const entries = read(
      expressRoutesAdapter,
      `import express from 'express';
       export function setup(options: { router: express.Router; routePath: string }) {
         const { router, routePath } = options;
         router.post('/upload', (_req, res) => res.send(routePath));
       }
       export function direct({ app }: { app: express.Application }) {
         app.put('/direct', (_req, res) => res.send(''));
       }`,
    );
    expect(labels(entries)).toEqual(['POST /upload', 'PUT /direct']);
  });

  it('follows a function of the repository that returns a router', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express, { Router } from 'express';
       const makeRouter = () => { const r = Router(); r.get('/x', (_q, s) => s.send('')); return r; };
       const app = express().disable('x-powered-by');
       app.use('/m', makeRouter());`,
    );
    expect(labels(entries)).toEqual(['GET /m/x']);
  });

  it('reads an application made from a package required where it is needed, whole or destructured (P281)', () => {
    const entries = read(
      expressRoutesAdapter,
      `export class StatusServer {
         start(port: number) {
           const express: typeof import('express') = require('express');
           const { Router } = require('express');
           const app = express();
           const extra = Router();
           app.get('/status', (_req, res) => res.send('ok'));
           extra.get('/ready', (_req, res) => res.send('ok'));
           app.use('/probe', extra);
           app.listen(port);
         }
       }`,
    );
    expect(labels(entries)).toEqual(['GET /probe/ready', 'GET /status']);
    const elsewhere = read(expressRoutesAdapter, `const lib = require('./local');\nconst app = lib();\napp.get('/no', () => undefined);`);
    expect(elsewhere).toEqual([]);
  });

  it('does not take a value of another uninstalled package for an application', () => {
    const entries = read(
      expressRoutesAdapter,
      `import { LRUCache } from 'lru-cache';
       import express from 'express';
       const cache = new LRUCache({ max: 1 });
       cache.get('/k', { allowStale: true });
       const parse = express.json();
       parse.get?.('/no', () => undefined);`,
    );
    expect(entries).toEqual([]);
  });

  it('never overrules a type the checker did resolve', () => {
    // `app` is a class of this repository, with a type, and it is not an
    // application: the source's `express` import beside it changes nothing.
    const entries = read(
      expressRoutesAdapter,
      `import express from 'express';
       class Settings { get(key: string, fallback: unknown) { return fallback; } }
       const app: Settings = new Settings();
       app.get('/not-a-route', () => undefined);
       void express;`,
    );
    expect(entries).toEqual([]);
  });

  it('reads the typed repository at static, as before', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express from 'express';
       const app = express();
       app.get('/typed', (_req, res) => res.send('ok'));`,
      {},
      {
        express: `export interface Express { get(path: string, ...h: Array<(q: unknown, s: { send(b: string): void }) => unknown>): Express }
          declare function express(): Express; export default express;`,
      },
    );
    expect(labels(entries)).toEqual(['GET /typed']);
    expect(entries[0]?.meta?.['confidence']).toBeUndefined();
  });

  it('gives Koa, Fastify and Hono the same reading from their own descriptions', () => {
    const koa = read(
      koaRoutesAdapter,
      `import Koa from 'koa';
       import Router from '@koa/router';
       export default function init(app: Koa = new Koa()) {
         const router = new Router({ prefix: '/k' });
         router.get('/one', (ctx) => { ctx.body = 1; });
         app.use(router.routes());
         return app;
       }`,
    );
    expect(labels(koa)).toEqual(['GET /k/one']);

    const fastify = read(
      fastifyRoutesAdapter,
      `import Fastify, { FastifyInstance } from 'fastify';
       const app = Fastify();
       async function routes(scope: FastifyInstance) { scope.get('/two', async () => 2); }
       app.register(routes, { prefix: '/f' });`,
    );
    expect(labels(fastify)).toEqual(['GET /f/two']);

    const hono = read(
      honoRoutesAdapter,
      `import { Hono } from 'hono';
       const app = new Hono().basePath('/h');
       app.get('/three', (c) => c.text('3'));
       app.get('/ctx', (c) => { c.get('orders'); return c.text(''); });`,
    );
    expect(labels(hono)).toEqual(['GET /h/ctx', 'GET /h/three']);
  });
});

/** Each route's label and the confidence it carries, `sure` where it carries none. */
const confidences = (entries: EntryNode[]): Record<string, string> =>
  Object.fromEntries(
    entries.map((entry) => [entry.label, String(entry.meta?.['confidence'] ?? 'sure')]),
  );

describe('an application made by the framework\'s own maker, called right there (P346)', () => {
  it('lifts every spelling of the maker imported or required from the package itself', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express from 'express';
       import * as whole from 'express';
       import { Router } from 'express';
       const required = require('express');
       const { Router: RequiredRouter } = require('express');
       const app = express().disable('x-powered-by');
       const ns = whole();
       const named = Router();
       const member = express.Router();
       const fromRequire = required();
       const destructured = RequiredRouter();
       let kept = express.Router();
       app.get('/app', (_q, s) => s.send(''));
       ns.get('/ns', (_q, s) => s.send(''));
       named.get('/named', (_q, s) => s.send(''));
       member.get('/member', (_q, s) => s.send(''));
       fromRequire.get('/required', (_q, s) => s.send(''));
       destructured.get('/destructured', (_q, s) => s.send(''));
       kept.get('/kept', (_q, s) => s.send(''));
       Router().get('/chained', (_q, s) => s.send('')).post('/chained', (_q, s) => s.send(''));
       app.route('/books').get((_q, s) => s.send(''));`,
    );
    expect(confidences(entries)).toEqual({
      'GET /app': 'sure',
      'GET /ns': 'sure',
      'GET /named': 'sure',
      'GET /member': 'sure',
      'GET /required': 'sure',
      'GET /destructured': 'sure',
      'GET /kept': 'sure',
      'GET /chained': 'sure',
      'POST /chained': 'sure',
      'GET /books': 'sure',
    });
  });

  it('keeps every other statement of the source heuristic', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express, { Router } from 'express';
       import type { Express } from 'express';
       import internal from 'express/lib/express';
       class ApiRouter extends Router {}
       const makeRouter = () => Router();
       const local = new ApiRouter();
       const made = makeRouter();
       const deep = internal();
       let moved = express.Router();
       moved = express.Router();
       local.get('/local-class', (_q, s) => s.send(''));
       made.get('/returned', (_q, s) => s.send(''));
       deep.get('/subpath', (_q, s) => s.send(''));
       moved.get('/reassigned', (_q, s) => s.send(''));
       export function install(app: Express) {
         app.get('/annotated', (_q, s) => s.send(''));
       }
       export function setup({ router }: { router: express.Router }) {
         router.get('/destructured', (_q, s) => s.send(''));
       }
       class Server { http = express(); start() { this.http.get('/property', (_q, s) => s.send('')); } }
       export const server = new Server();
       server.http = Router();`,
    );
    expect(confidences(entries)).toEqual({
      'GET /local-class': 'heuristic',
      'GET /returned': 'heuristic',
      'GET /subpath': 'heuristic',
      'GET /reassigned': 'heuristic',
      'GET /annotated': 'heuristic',
      'GET /destructured': 'heuristic',
      'GET /property': 'heuristic',
    });
  });

  it('keeps a direct router heuristic under a mount written on an application it only stated', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express from 'express';
       const users = express.Router();
       users.get('/users', (_q, s) => s.send(''));
       const app = express();
       app.use('/v1', users);
       const makeApp = () => express();
       const outer = makeApp();
       outer.use('/v2', users);`,
    );
    expect(confidences(entries)).toEqual({ 'GET /v1/users': 'sure', 'GET /v2/users': 'heuristic' });
  });

  it('lifts Koa, Fastify and Hono made by their own makers, and not what arrives as a parameter', () => {
    const koa = read(
      koaRoutesAdapter,
      `import Koa from 'koa';
       import Router from '@koa/router';
       const app = new Koa();
       const router = new Router({ prefix: '/k' });
       router.get('/one', (ctx) => { ctx.body = 1; });
       app.use(router.routes());
       export default function init(other: Koa = new Koa()) {
         const inner = new Router();
         inner.get('/two', (ctx) => { ctx.body = 2; });
         other.use(inner.routes());
       }`,
    );
    expect(confidences(koa)).toEqual({ 'GET /k/one': 'sure', 'GET /two': 'heuristic' });

    const fastify = read(
      fastifyRoutesAdapter,
      `import Fastify, { FastifyInstance } from 'fastify';
       const app = Fastify();
       app.get('/top', async () => 1);
       async function routes(scope: FastifyInstance) { scope.get('/two', async () => 2); }
       app.register(routes, { prefix: '/f' });`,
    );
    expect(confidences(fastify)).toEqual({ 'GET /top': 'sure', 'GET /f/two': 'heuristic' });

    const hono = read(
      honoRoutesAdapter,
      `import { Hono } from 'hono';
       const app = new Hono().basePath('/h');
       const api = app.basePath('/api');
       app.get('/three', (c) => c.text('3'));
       api.get('/four', (c) => c.text('4'));`,
    );
    expect(confidences(hono)).toEqual({ 'GET /h/three': 'sure', 'GET /h/api/four': 'sure' });
  });
});

describe('a field and a parameter default holding what a maker made (P350)', () => {
  it('lifts a field its own class alone writes, each time directly, and keeps one written otherwise heuristic (P354)', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express, { Router } from 'express';
       class Server {
         readonly app = express();
         private router = Router();
         private admin = Router();
         private moved = Router();
         static shared = Router();
         constructor(flag: boolean) {
           if (flag) this.admin = express.Router();
         }
         start() {
           this.router.get('/field', (_q, s) => s.send(''));
           this.admin.get('/constructed', (_q, s) => s.send(''));
           this.moved.get('/moved', (_q, s) => s.send(''));
           this.app.use('/api', this.router);
           this.reset();
         }
         reset() { this.moved = Router(); }
       }
       class Other { handler = Router(); constructor() { this.handler = makeRouter(); } go() { this.handler.get('/made', (_q, s) => s.send('')); } }
       const makeRouter = () => Router();`,
    );
    expect(confidences(entries)).toEqual({
      'GET /api/field': 'sure',
      'GET /constructed': 'sure',
      'GET /moved': 'sure',
      'GET /made': 'heuristic',
    });
  });

  it("lifts a parameter's default where every caller hands it nothing or a maker's value, and not where one may hand it something else (P354)", () => {
    const entries = read(
      expressRoutesAdapter,
      `import express, { Router } from 'express';
       function mount(router = Router()) { router.get('/defaulted', (_q, s) => s.send('')); return router; }
       mount();
       mount(undefined);
       const install = (router = Router()) => { router.get('/handed', (_q, s) => s.send('')); };
       install();
       install(makeRouter());
       function never(router = Router()) { router.get('/uncalled', (_q, s) => s.send('')); }
       function passed(router = Router()) { router.get('/passed', (_q, s) => s.send('')); }
       [1].forEach(() => passed());
       setTimeout(passed);
       class Api { constructor(private readonly http = express()) { this.http.get('/property', (_q, s) => s.send('')); } }
       new Api();
       function makeRouter() { return Router(); }`,
    );
    expect(confidences(entries)).toEqual({
      'GET /defaulted': 'sure',
      'GET /handed': 'heuristic',
      'GET /uncalled': 'heuristic',
      'GET /passed': 'heuristic',
      'GET /property': 'sure',
    });
  });
});

describe('an application held by a property, handed as a parameter, or given by a constructor (P354)', () => {
  it('lifts a property every write of which is placed, inside its class or module, and direct', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express, { Router } from 'express';
       import { replace } from './elsewhere';
       export const server = { app: express(), admin: Router() };
       const literal = { app: express() };
       const patched = { app: express() };
       patched.app = makeApp();
       server.app.get('/literal', (_q, s) => s.send(''));
       literal['app'].get('/bracketed', (_q, s) => s.send(''));
       patched.app.get('/patched', (_q, s) => s.send(''));
       server.admin.get('/written-elsewhere', (_q, s) => s.send(''));
       class Api {
         http = express();
         reset() { this.http = express(); }
       }
       const api = new Api();
       api.http.get('/instance', (_q, s) => s.send(''));
       class Assigned {
         http = express();
         constructor(options: object) { Object.assign(this, options); }
         go() { this.http.get('/assigned', (_q, s) => s.send('')); }
       }
       class Untyped {
         router = Router();
         go() { this.router.get('/untyped-write', (_q, s) => s.send('')); }
       }
       function swap(anything) { anything.router = makeApp(); }
       function makeApp() { return express(); }`,
      {
        '/src/elsewhere.ts': `import { Router } from 'express';
          import { server } from './main';
          export const replace = () => { server.admin = Router(); };`,
      },
    );
    expect(confidences(entries)).toEqual({
      'GET /literal': 'sure',
      'GET /bracketed': 'sure',
      'GET /patched': 'heuristic',
      'GET /written-elsewhere': 'heuristic',
      'GET /instance': 'sure',
      'GET /assigned': 'heuristic',
      'GET /untyped-write': 'heuristic',
    });
  });

  it('lifts a parameter every caller found hands a direct value, by name or however it is reached', () => {
    const entries = read(
      koaRoutesAdapter,
      `import Koa from 'koa';
       import Router from '@koa/router';
       import services from './services';
       import mountAdmin from './admin';
       import { routes } from './routes';
       import mountJobs from './jobs';
       export async function start(name: keyof typeof services) {
         const app = new Koa();
         const { default: init } = await services[name]();
         init(app);
         const docs = await import('./docs');
         docs.default(app);
         mountJobs();
         mountAdmin();
         routes.mount(app);
         walk(app, 2);
         share(app);
         share(makeKoa());
       }
       function walk(app: Koa, depth: number) {
         if (depth > 0) walk(app, depth - 1);
         const router = new Router();
         router.get('/walked', (ctx) => { ctx.body = 1; });
         app.use(router.routes());
       }
       function share(app: Koa) {
         const router = new Router();
         router.get('/shared', (ctx) => { ctx.body = 1; });
         app.use(router.routes());
       }
       function makeKoa() { return new Koa(); }`,
      {
        '/src/services.ts': `const services = { web: () => import('./web') } as const;
          export default services;`,
        '/src/web.ts': `import Koa from 'koa';
          import Router from '@koa/router';
          export default function init(app: Koa = new Koa()) {
            const router = new Router();
            router.get('/web', (ctx) => { ctx.body = 1; });
            app.use(router.routes());
          }`,
        '/src/jobs.ts': `import Koa from 'koa';
          import Router from '@koa/router';
          export default function (app: Koa = new Koa()) {
            const router = new Router();
            router.get('/jobs', (ctx) => { ctx.body = 1; });
            app.use(router.routes());
          }`,
        '/src/docs.ts': `import Koa from 'koa';
          import Router from '@koa/router';
          export default function mountDocs(app: Koa) {
            const router = new Router();
            router.get('/docs', (ctx) => { ctx.body = 1; });
            app.use(router.routes());
          }`,
        '/src/admin.ts': `import Koa from 'koa';
          import Router from '@koa/router';
          export default (app: Koa = new Koa()) => {
            const router = new Router();
            router.get('/admin', (ctx) => { ctx.body = 1; });
            app.use(router.routes());
          };`,
        '/src/routes.ts': `import Koa from 'koa';
          import Router from '@koa/router';
          export const routes = {
            mount(app: Koa) {
              const router = new Router();
              router.get('/member', (ctx) => { ctx.body = 1; });
              app.use(router.routes());
            },
          };`,
      },
    );
    expect(confidences(entries)).toEqual({
      'GET /web': 'sure',
      'GET /docs': 'sure',
      'GET /jobs': 'sure',
      'GET /admin': 'sure',
      'GET /member': 'sure',
      'GET /walked': 'sure',
      'GET /shared': 'heuristic',
    });
  });

  it('recognises a field declared bare and given its application by the constructor, and lifts it where only that writes it', () => {
    const entries = read(
      expressRoutesAdapter,
      `import express, { Router, Application } from 'express';
       class Bare {
         app;
         constructor() { this.app = express(); }
         start() { this.app.get('/bare', (_q, s) => s.send('')); }
       }
       class Typed {
         private app: Application;
         constructor() { this.app = express(); }
         start() { this.app.get('/typed', (_q, s) => s.send('')); }
       }
       class Replaced {
         router;
         constructor() { this.router = Router(); }
         reset(next) { this.router = next; }
         start() {
           this.router.get('/replaced', (_q, s) => s.send(''));
           const app = express();
           app.use('/under', this.router);
         }
       }`,
      {
        '/src/plain.js': `const express = require('express');
          class Plain {
            constructor() { this.app = express(); }
            start() { this.app.get('/plain', (_q, s) => s.send('')); }
          }
          module.exports = Plain;`,
      },
    );
    expect(confidences(entries)).toEqual({
      'GET /bare': 'sure',
      'GET /typed': 'sure',
      'GET /under/replaced': 'heuristic',
      'GET /plain': 'sure',
    });
  });
});
