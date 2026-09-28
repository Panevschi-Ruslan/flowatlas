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
  it('reads express() and express.Router(), mounted, as heuristic', () => {
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
    expect(entries.every((entry) => entry.meta?.['confidence'] === 'heuristic')).toBe(true);
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
