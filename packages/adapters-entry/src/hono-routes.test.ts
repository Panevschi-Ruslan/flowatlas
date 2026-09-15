import {
  GraphBuilder,
  isFunctionHandler,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { honoRoutesAdapter } from './hono-routes.js';

/**
 * Enough of the framework for the type of a receiver to mean something.
 *
 * `Context.get` is the shape the adapter has to refuse: same package, same
 * method name, no route anywhere near it.
 */
const HONO = `
export declare class HonoRequest { param(name: string): string }
export declare class Context {
  readonly req: HonoRequest;
  get(key: string): any;
  json(value: unknown): unknown;
  text(value: string): unknown;
}
export type Handler = (c: Context) => unknown;
export declare class Hono {
  get(path: string, ...handlers: Handler[]): Hono;
  post(path: string, ...handlers: Handler[]): Hono;
  delete(path: string, ...handlers: Handler[]): Hono;
  all(path: string, ...handlers: Handler[]): Hono;
  on(method: string | string[], path: string, ...handlers: Handler[]): Hono;
  use(path: string, ...handlers: Handler[]): Hono;
  route(path: string, app: Hono): Hono;
  basePath(path: string): Hono;
}
`;

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

/** `files` is what the repository holds besides `worker.ts`. */
const extract = (worker: string, files: Record<string, string> = {}): Read => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false },
  });
  project.createSourceFile('/node_modules/hono/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/hono/index.d.ts', HONO);
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  project.createSourceFile('/src/worker.ts', worker);

  const ctx: ExtractContext = {
    repo: 'api',
    repoDir: '/',
    service: { name: 'api', repo: '/', type: 'nestjs' },
    config: parseConfig({}),
    pkg: { dependencies: { hono: '^4.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  const entries = honoRoutesAdapter.extractEntries(ctx);
  return { entries, unresolved: ctx.builder.build().unresolved };
};

const ids = (read: Read): string[] => read.entries.map((entry) => entry.id).sort();

describe('routes declared by calling the application', () => {
  it('runs where the framework is a dependency', () => {
    expect(honoRoutesAdapter.detect({ dependencies: { hono: '^4.0.0' } })).toBe(true);
    expect(honoRoutesAdapter.detect({ dependencies: { express: '^4.0.0' } })).toBe(false);
  });

  it('records the verb and the path as declared, prefix included', () => {
    const read = extract(`
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/api/depots/:depotId/stream', (c) => c.text('x'));
      app.post('/messenger/webhook', (c) => c.text('x'));
    `);
    expect(ids(read)).toEqual([
      'entry:api:http:GET:/api/depots/:param/stream',
      'entry:api:http:POST:/messenger/webhook',
    ]);
    expect(read.entries[0]?.meta?.['rawPath']).toBe('/api/depots/:depotId/stream');
  });

  it('points a route at the function it names, not at what surrounds it', () => {
    const read = extract(
      `
      import { Hono } from 'hono';
      import { sseSubscribe } from './stream.js';
      export const install = (app: Hono): void => {
        app.get('/stream', sseSubscribe);
      };
      const app = new Hono();
      install(app);
    `,
      {
        '/src/stream.ts':
          "import type { Context } from 'hono';\nexport function sseSubscribe(c: Context) { return c.text('x'); }",
      },
    );
    const handler = read.entries[0]?.handler;
    expect(handler !== undefined && isFunctionHandler(handler) && handler.functionName).toBe(
      'sseSubscribe',
    );
    expect(read.entries[0]?.meta?.['handlerVia']).toBe('function');
  });

  it('reads past the middleware written between the path and the handler', () => {
    const read = extract(
      `
      import { Hono } from 'hono';
      import { withNest } from './with-nest.js';
      import { receive } from './receive.js';
      const app = new Hono();
      app.post('/webhook', withNest, receive);
    `,
      {
        '/src/with-nest.ts': "export const withNest = (c: unknown) => c;",
        '/src/receive.ts':
          "import type { Context } from 'hono';\nexport function receive(c: Context) { return c.text('x'); }",
      },
    );
    const handler = read.entries[0]?.handler;
    expect(handler !== undefined && isFunctionHandler(handler) && handler.functionName).toBe(
      'receive',
    );
    expect(read.entries[0]?.meta?.['middleware']).toEqual(['withNest']);
  });

  it('keeps a route whose handler is written in place, and points at that function', () => {
    const read = extract(`
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/health', (c) => c.json({ ok: true }));
      app.get('/ready', (c) => c.json({ ok: true }));
    `);
    expect(ids(read)).toEqual(['entry:api:http:GET:/health', 'entry:api:http:GET:/ready']);
    // The function written in place is the handler: found again by where it
    // starts, so a walk from the route goes on into it, and nothing is reported.
    expect(read.entries[0]?.handler).toMatchObject({ inline: true, label: 'GET /health', line: 4 });
    expect(read.entries[0]?.meta?.['handlerVia']).toBe('inline');
    expect(read.unresolved).toEqual([]);
  });

  it('follows a handler written in place to the single thing it delegates to', () => {
    const read = extract(
      `
      import { Hono } from 'hono';
      import { forward } from './forward.js';
      const app = new Hono();
      app.all('/api/*', (c) => forward(c));
    `,
      {
        '/src/forward.ts':
          "import type { Context } from 'hono';\nexport function forward(c: Context) { return c.text('x'); }",
      },
    );
    const handler = read.entries[0]?.handler;
    expect(handler !== undefined && isFunctionHandler(handler) && handler.functionName).toBe(
      'forward',
    );
    expect(read.entries[0]?.meta?.['handlerVia']).toBe('call');
  });

  it('refuses a named call the handler makes on its way to answering', () => {
    // Eight of the real project's worker routes call a boot helper first and
    // answer afterwards. Pointing the route at the helper says the request ends
    // where it starts, so only what the function gives back counts.
    const read = extract(
      `
      import { Hono } from 'hono';
      import { boot } from './boot.js';
      const app = new Hono();
      app.post('/webhook', async (c) => {
        const container = await boot();
        return c.json({ booted: Boolean(container) });
      });
    `,
      { '/src/boot.ts': 'export async function boot() { return {}; }' },
    );
    // Not the helper: the function written in place, which is what answers.
    expect(read.entries[0]?.handler).toMatchObject({ inline: true, label: 'POST /webhook' });
    expect(read.entries[0]?.meta?.['handlerVia']).toBe('inline');
  });

  it('takes a named call the handler returns', () => {
    const read = extract(
      `
      import { Hono } from 'hono';
      import { answer } from './answer.js';
      const app = new Hono();
      app.post('/webhook', async (c) => {
        if (!c.req) return c.text('no');
        return await answer(c);
      });
    `,
      {
        '/src/answer.ts':
          "import type { Context } from 'hono';\nexport async function answer(c: Context) { return c.text('x'); }",
      },
    );
    expect(read.entries[0]?.meta?.['handlerVia']).toBe('call');
  });

  it('reads a verb given as an argument', () => {
    const read = extract(`
      import { Hono } from 'hono';
      const app = new Hono();
      app.on('DELETE', '/cache', (c) => c.text('x'));
      app.on(['GET', 'HEAD'], '/probe', (c) => c.text('x'));
    `);
    expect(ids(read)).toEqual([
      'entry:api:http:DELETE:/cache',
      'entry:api:http:GET:/probe',
      'entry:api:http:HEAD:/probe',
    ]);
  });

  it('says nothing about middleware, which is not a way in', () => {
    const read = extract(`
      import { Hono } from 'hono';
      import { log } from './log.js';
      const app = new Hono();
      app.use('*', log);
    `, { '/src/log.ts': 'export const log = (c: unknown) => c;' });
    expect(read.entries).toEqual([]);
    expect(read.unresolved).toEqual([]);
  });

  it('says nothing about a value read off the request, which is the same shape', () => {
    // `c.get('orders')` is a call on a receiver from the same package, with a
    // string literal for an argument. Only the application declares routes.
    const read = extract(`
      import { Hono, type Context } from 'hono';
      const app = new Hono();
      const read = (c: Context) => c.get('orders');
      app.get('/orders', read);
    `);
    expect(ids(read)).toEqual(['entry:api:http:GET:/orders']);
  });

  it('reports a path built at run time instead of inventing one', () => {
    const read = extract(`
      import { Hono } from 'hono';
      const app = new Hono();
      const at = (name: string): string => '/api/' + name;
      app.get(at('stats'), (c) => c.text('x'));
    `);
    expect(read.entries).toEqual([]);
    expect(read.unresolved.map((row) => row.reason)).toEqual(['route-path-dynamic']);
  });
});

describe('an application that is not served where it is declared', () => {
  it('records a mounted application a level down', () => {
    const read = extract(
      `
      import { Hono } from 'hono';
      import { adminRoutes } from './admin.js';
      const app = new Hono();
      app.route('/api/admin', adminRoutes);
    `,
      {
        '/src/admin.ts':
          "import { Hono } from 'hono';\nexport const adminRoutes = new Hono();\nadminRoutes.get('/events', (c) => c.text('x'));",
      },
    );
    expect(ids(read)).toContain('entry:api:http:GET:/api/admin/events');
  });

  it('carries a shifted base into every route written on it', () => {
    const read = extract(`
      import { Hono } from 'hono';
      const app = new Hono();
      const internal = app.basePath('/internal');
      internal.post('/reload', (c) => c.text('x'));
    `);
    expect(ids(read)).toEqual(['entry:api:http:POST:/internal/reload']);
  });

  it('refuses a route on an application that arrived from somewhere unread', () => {
    // The repository shifts bases elsewhere, so `/daily` on its own would be an
    // address this service does not serve.
    const read = extract(
      `
      import { Hono } from 'hono';
      import { registerReports } from './reports.js';
      const app = new Hono();
      const internal = app.basePath('/internal');
      internal.post('/reload', (c) => c.text('x'));
      registerReports(app);
    `,
      {
        '/src/reports.ts':
          "import type { Hono } from 'hono';\nexport const registerReports = (app: Hono) => { app.get('/daily', (c) => c.text('x')); };",
      },
    );
    expect(ids(read)).toEqual(['entry:api:http:POST:/internal/reload']);
    expect(read.unresolved.map((row) => row.reason)).toContain('route-path-dynamic');
  });

  it('takes such a route as declared where nothing in the repository shifts a base', () => {
    const read = extract(
      `
      import { Hono } from 'hono';
      import { registerReports } from './reports.js';
      const app = new Hono();
      registerReports(app);
    `,
      {
        '/src/reports.ts':
          "import type { Hono } from 'hono';\nexport const registerReports = (app: Hono) => { app.get('/daily', (c) => c.text('x')); };",
      },
    );
    expect(ids(read)).toEqual(['entry:api:http:GET:/daily']);
    expect(read.unresolved.filter((row) => row.reason === 'route-path-dynamic')).toEqual([]);
  });
});
