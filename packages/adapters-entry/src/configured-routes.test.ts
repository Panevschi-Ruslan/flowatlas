import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { configuredRoutesAdapter, CONFIGURED_ROUTES } from './configured-routes.js';
import { dialectOf, EXPRESS, HONO, KOA } from './route-dialects.js';

/**
 * A framework nothing in this repository has ever heard of.
 *
 * Its spelling is close enough to a real one to be plausible and different
 * enough that no shipped row would match it by accident: routes on a server
 * value, a child server hung on a parent by a method of its own, and middleware
 * installed by another.
 */
const MINIHTTP = `
export type Handler = (req: unknown, res: unknown) => unknown;
export declare class Server {
  get(path: string, ...handlers: Handler[]): Server;
  post(path: string, ...handlers: Handler[]): Server;
  use(pathOrHandler: string | Handler, ...handlers: Handler[]): Server;
  attach(path: string, child: Server): Server;
}
export declare function createServer(): Server;
`;

const DESCRIPTION = {
  name: 'minihttp-routes',
  packages: ['minihttp'],
  appTypes: [{ packages: ['minihttp'], typeNames: ['Server'] }],
  mount: { method: 'attach', appArg: 1, pathArg: 0 },
  middleware: { method: 'use', scoped: true },
};

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

const read = (
  http: unknown[],
  files: Record<string, string>,
  dependencies: Record<string, string> = { minihttp: '^1.0.0' },
): Read => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  project.createSourceFile('/node_modules/minihttp/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/minihttp/index.d.ts', MINIHTTP);
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);

  const ctx: ExtractContext = {
    repo: 'api',
    repoDir: '/',
    service: { name: 'api', repo: '/', type: 'nestjs' },
    config: parseConfig({ adapters: { entry: { http } } }),
    pkg: { dependencies },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return {
    entries: configuredRoutesAdapter.extractEntries(ctx),
    unresolved: ctx.builder.build().unresolved,
  };
};

const ids = (found: Read): string[] => found.entries.map((entry) => entry.id).sort();
const reasons = (found: Read): string[] => found.unresolved.map((row) => row.reason);

describe('a framework described rather than shipped', () => {
  it('reads its routes, its mount and its guard from the description alone', () => {
    const found = read([DESCRIPTION], {
      '/src/orders.ts': `
        import { createServer } from 'minihttp';
        import { listOrders } from './handlers';
        export const ordersRouter = createServer();
        ordersRouter.get('/', listOrders);
        ordersRouter.post('/:id/cancel', listOrders);
      `,
      '/src/handlers.ts': `export const listOrders = (req: unknown, res: unknown) => res;
        export const authenticate = (req: unknown, res: unknown) => res;`,
      '/src/main.ts': `
        import { createServer } from 'minihttp';
        import { authenticate } from './handlers';
        import { ordersRouter } from './orders';
        const app = createServer();
        app.use(authenticate);
        app.attach('/orders', ordersRouter);
      `,
    });
    expect(ids(found)).toEqual([
      'entry:api:http:GET:/orders',
      'entry:api:http:POST:/orders/:param/cancel',
    ]);
    // The guard is installed on the parent above the mount, so it stands in
    // front of every route the mounted server declares, in a file it never
    // appears in.
    expect(found.entries[0]?.wrapping?.map((one) => one.label)).toEqual(['authenticate']);
  });

  it('says which description read each route, so a project may have several', () => {
    const found = read([DESCRIPTION], {
      '/src/main.ts': `
        import { createServer } from 'minihttp';
        const app = createServer();
        app.get('/health', (req, res) => res);
      `,
    });
    expect(found.entries[0]?.meta?.['description']).toBe('minihttp-routes');
  });

  // The failure mode of every configuration-driven reader is silence that looks
  // like a clean repository, so each silence says which part of the description
  // matched nothing.
  it('reports a description whose types match nothing', () => {
    const found = read(
      [{ ...DESCRIPTION, appTypes: [{ packages: ['minihttp'], typeNames: ['Aplication'] }] }],
      {
        '/src/main.ts': `
        import { createServer } from 'minihttp';
        const app = createServer();
        app.get('/health', (req, res) => res);
      `,
      },
    );
    expect(found.entries).toHaveLength(0);
    expect(reasons(found)).toEqual(['entry-http-types-unmatched']);
  });

  it('reports a description whose types match and whose verbs do not', () => {
    const found = read([{ ...DESCRIPTION, verbs: { fetch: 'GET' } }], {
      '/src/main.ts': `
        import { createServer } from 'minihttp';
        const app = createServer();
        app.get('/health', (req, res) => res);
      `,
    });
    expect(found.entries).toHaveLength(0);
    expect(reasons(found)).toEqual(['entry-http-routes-unmatched']);
  });

  it('says a description was not tried where none of its packages is a dependency', () => {
    const found = read([DESCRIPTION], { '/src/main.ts': 'export const nothing = 1;' }, {
      'other-framework': '^1.0.0',
    });
    expect(found.entries).toHaveLength(0);
    expect(reasons(found)).toEqual(['entry-http-description-inactive']);
  });

  // Detection is offered the configuration as well as the manifest, so a
  // description turns its own reader on where its packages say it lives.
  it('recognises a repository a description is about', () => {
    const config = parseConfig({ adapters: { entry: { http: [DESCRIPTION] } } });
    expect(configuredRoutesAdapter.detect({ dependencies: { minihttp: '^1.0.0' } }, config)).toBe(
      true,
    );
    expect(configuredRoutesAdapter.name).toBe(CONFIGURED_ROUTES);
  });

  it('recognises nothing where no description is about this repository', () => {
    const config = parseConfig({ adapters: { entry: { http: [DESCRIPTION] } } });
    expect(
      configuredRoutesAdapter.detect({ dependencies: { 'other-framework': '^1.0.0' } }, config),
    ).toBe(false);
  });

  // The whole reason this adapter recognised nothing for so long: a project
  // that has described no framework must not carry its name on every
  // repository node it has.
  it('recognises nothing where nothing was described, and nothing without a configuration', () => {
    expect(configuredRoutesAdapter.detect({ dependencies: { minihttp: '^1.0.0' } }, parseConfig({})))
      .toBe(false);
    expect(configuredRoutesAdapter.detect({ dependencies: { minihttp: '^1.0.0' } })).toBe(false);
  });

  // A description with no packages cannot be placed by a manifest, so it says
  // it is tried everywhere and the reader is on everywhere it is written.
  it('recognises every repository when a description names no packages', () => {
    const config = parseConfig({
      adapters: { entry: { http: [{ ...DESCRIPTION, packages: [] }] } },
    });
    expect(configuredRoutesAdapter.detect({}, config)).toBe(true);
  });
});

describe('the shipped frameworks are written in that same description', () => {
  it('expands a group of packages and type names into every pair', () => {
    expect(EXPRESS.appTypes).toHaveLength(12);
    expect(EXPRESS.appTypes).toContainEqual({ package: 'express', typeName: 'Router' });
    expect(KOA.appTypes).toContainEqual({ package: '@koa/router', typeName: 'Router' });
  });

  it('carries every field the four of them needed', () => {
    expect(EXPRESS.mount).toEqual({ method: 'use', appAt: -1, pathAt: 0 });
    expect(EXPRESS.middleware).toEqual({ install: 'use', scoped: true });
    expect(KOA.mount?.through).toEqual(['routes', 'allowedMethods']);
    expect(KOA.prefixMutates).toBe(true);
    expect(HONO.verbArgument).toBe('on');
  });

  it('leaves out what a description did not say, rather than saying it falsely', () => {
    expect(EXPRESS.prefixMutates).toBeUndefined();
    expect(EXPRESS.mount?.asPlugin).toBeUndefined();
    expect(HONO.middleware?.optionKeys).toBeUndefined();
  });

  it('fills the positions every one of them shares', () => {
    for (const dialect of [EXPRESS, HONO, KOA]) {
      expect(dialect.pathAt).toBe(0);
      expect(dialect.handlerAt).toBe(-1);
      expect(dialect.middlewareBetween).toBe(true);
      expect([...dialect.verbs.keys()]).toContain('get');
    }
  });

  it('turns a description into a dialect without going near configuration', () => {
    const [described] = parseConfig({ adapters: { entry: { http: [DESCRIPTION] } } }).adapters.entry
      .http;
    expect(described).toBeDefined();
    if (described === undefined) return;
    const dialect = dialectOf(described);
    expect(dialect.name).toBe('minihttp-routes');
    expect(dialect.mount).toEqual({ method: 'attach', appAt: 1, pathAt: 0 });
  });
});

describe('what a request carries, in the same description (P29)', () => {
  it('ships where every framework that registers by a call puts the request and the answer', () => {
    for (const dialect of [EXPRESS, HONO, KOA]) {
      expect(dialect.request).toBeDefined();
      // The validators are no framework's, and every description is handed them.
      expect(dialect.request?.validators.map((validator) => validator.package)).toContain('zod');
    }
    expect(EXPRESS.request?.parts.body).toEqual([{ param: 0, at: ['body'], text: false }]);
    expect(KOA.request?.answers).toEqual([{ by: 'assign', param: 0, at: ['body'] }]);
  });

  it('hands a route the reading its description gives, and none where it gives none', () => {
    const request = {
      parts: { body: [{ param: 0, at: ['payload'] }] },
      answers: [{ by: 'call', param: 1, methods: ['reply'] }],
    };
    const handler = `
      import { createServer } from 'minihttp';
      const app = createServer();
      app.post('/orders', (req, res) => res);
    `;
    const [withReading] = read([{ ...DESCRIPTION, request }], { '/src/app.ts': handler }).entries;
    expect(withReading?.request?.parts.body).toEqual([{ param: 0, at: ['payload'], text: false }]);
    expect(withReading?.request?.validators.length).toBeGreaterThan(0);
    const [without] = read([DESCRIPTION], { '/src/app.ts': handler }).entries;
    expect(without?.request).toBeUndefined();
  });

  it('refuses a description of the request that says how rather than where', () => {
    expect(() =>
      parseConfig({
        adapters: { entry: { http: [{ ...DESCRIPTION, request: { answers: [{ by: 'compute', code: 'x' }] } }] } },
      }),
    ).toThrow();
  });
});
