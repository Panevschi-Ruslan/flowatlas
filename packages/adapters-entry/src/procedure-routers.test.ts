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
import { configuredProceduresAdapter } from './configured-procedures.js';
import { TRPC } from './procedure-dialects.js';
import { trpcProceduresAdapter } from './procedure-routers.js';

/**
 * The library, shaped in the two ways the reading depends on.
 *
 * Nothing is a class, so a repository publishes the root's members under its own
 * names; and a builder's methods return another builder, so only the last link
 * of a chain ends it. A reader that looked one call deep would pass against a
 * stub that got the second wrong, which is why this one does not.
 */
const TRPC_SERVER = `
export interface Procedure { readonly _procedure: true }
export interface Router { readonly _router: true }
export type Resolver = (opts: { ctx: unknown; input: unknown }) => unknown;
export interface Middleware { readonly _middleware: true }
export interface ProcedureBuilder {
  input(schema: unknown): ProcedureBuilder;
  use(middleware: unknown): ProcedureBuilder;
  query(resolver: Resolver): Procedure;
  mutation(resolver: Resolver): Procedure;
}
export interface TRPCRoot {
  router(shape: Record<string, Procedure | Router>): Router;
  middleware(fn: unknown): Middleware;
  readonly procedure: ProcedureBuilder;
}
export interface TRPCInit { create(): TRPCRoot }
export declare const initTRPC: TRPCInit;
`;

/** The project's own module, which is where every repository of this shape starts. */
const OWN_TRPC = `
import { initTRPC } from '@trpc/server';
const t = initTRPC.create();
export const router = t.router;
export const middleware = t.middleware;
export const procedure = t.procedure;
`;

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

const contextFor = (
  files: Record<string, string>,
  dependencies: Record<string, string>,
  procedures: unknown[],
): ExtractContext => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  project.createSourceFile('/node_modules/@trpc/server/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/@trpc/server/index.d.ts', TRPC_SERVER);
  project.createSourceFile('/server/trpc.ts', OWN_TRPC);
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);

  return {
    repo: 'api',
    repoDir: '/',
    service: { name: 'api', repo: '/', type: 'nextjs' },
    config: parseConfig({ adapters: { entry: { procedures } } }),
    pkg: { dependencies },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
};

const read = (
  files: Record<string, string>,
  dependencies: Record<string, string> = { '@trpc/server': '^11.0.0' },
): Read => {
  const ctx = contextFor(files, dependencies, []);
  return {
    entries: trpcProceduresAdapter.extractEntries(ctx),
    unresolved: ctx.builder.build().unresolved,
  };
};

const keys = (found: Read): string[] => found.entries.map((entry) => entry.key).sort();
const reasons = (found: Read): string[] => found.unresolved.map((row) => row.reason).sort();
const chainOf = (found: Read, key: string): string[] | undefined =>
  found.entries.find((entry) => entry.key === key)?.wrapping?.map((one) => one.label);
const metaOf = (found: Read, key: string): Record<string, unknown> =>
  (found.entries.find((entry) => entry.key === key)?.meta ?? {}) as Record<string, unknown>;

describe('ways in that are the keys of a tree', () => {
  it('names one by every key above it, down a tree assembled across files', () => {
    const found = read({
      '/server/orders.ts': `
        import { procedure, router } from './trpc';
        export const ordersRouter = router({
          list: procedure.query(() => []),
          create: procedure.mutation(() => ({})),
        });
      `,
      '/server/root.ts': `
        import { ordersRouter } from './orders';
        import { router } from './trpc';
        export const appRouter = router({ orders: ordersRouter });
      `,
    });
    expect(keys(found)).toEqual(['orders.create', 'orders.list']);
    expect(found.entries.every((entry) => entry.kind === 'rpc')).toBe(true);
  });

  it('follows a member written shorthand, which names it after the tree', () => {
    const found = read({
      '/server/reports.ts': `
        import { procedure, router } from './trpc';
        export const reportsRouter = router({ daily: procedure.query(() => []) });
      `,
      '/server/root.ts': `
        import { reportsRouter } from './reports';
        import { router } from './trpc';
        export const appRouter = router({ reportsRouter });
      `,
    });
    // Not `daily`: a shorthand property's name node carries the member's own
    // symbol, and following that leads back into the literal it was written in.
    expect(keys(found)).toEqual(['reportsRouter.daily']);
  });

  it('reads the guards off whatever the chain starts from, wherever that is', () => {
    const found = read({
      '/server/guards.ts': `
        import { middleware } from './trpc';
        export const isSignedIn = middleware(({ next }) => next());
        export const isAdmin = middleware(({ next }) => next());
      `,
      '/server/procedures.ts': `
        import { isAdmin, isSignedIn } from './guards';
        import { procedure } from './trpc';
        export const authedProcedure = procedure.use(isSignedIn);
        export const adminProcedure = authedProcedure.use(isAdmin);
      `,
      '/server/root.ts': `
        import { adminProcedure, authedProcedure } from './procedures';
        import { router } from './trpc';
        export const appRouter = router({
          mine: authedProcedure.query(() => []),
          all: adminProcedure.query(() => []),
        });
      `,
    });
    expect(chainOf(found, 'mine')).toEqual(['isSignedIn']);
    // Both, in the order the framework applies them, through two definitions.
    expect(chainOf(found, 'all')).toEqual(['isSignedIn', 'isAdmin']);
    // Described where each was installed, so one guard on a starting point is
    // one node however many ways in begin from it — and never a list on the
    // entry, which read as an unguarded way in to every reader of edges (R109).
    const all = found.entries.find((entry) => entry.key === 'all');
    expect(all?.wrapping?.map(({ file, source, scope }) => ({ file, source, scope }))).toEqual([
      { file: 'server/procedures.ts', source: 'authedProcedure', scope: 'prefix' },
      { file: 'server/procedures.ts', source: 'adminProcedure', scope: 'prefix' },
    ]);
    expect(metaOf(found, 'all')['middleware']).toBeUndefined();
  });

  it('describes a guard written on the way in itself as scoped to that one', () => {
    const found = read({
      '/server/root.ts': `
        import { middleware, procedure, router } from './trpc';
        const audit = middleware(({ next }) => next());
        export const appRouter = router({
          one: procedure.use(audit).query(() => []),
        });
      `,
    });
    const one = found.entries.find((entry) => entry.key === 'one');
    expect(one?.wrapping?.map(({ label, scope, source }) => ({ label, scope, source }))).toEqual([
      { label: 'audit', scope: 'route', source: '.use' },
    ]);
  });

  it('records the shape a caller sends and which ending the chain had', () => {
    const found = read({
      '/server/root.ts': `
        import { procedure, router } from './trpc';
        export const OrderBody = { sku: '' };
        export const appRouter = router({
          create: procedure.input(OrderBody).mutation(() => ({})),
        });
      `,
    });
    expect(metaOf(found, 'create')).toMatchObject({ call: 'mutation', input: 'OrderBody' });
  });

  it('is not fooled by an object literal handed to something called router', () => {
    const found = read({
      '/server/router.ts': `
        export const router = (routes: Record<string, string>) => routes;
        export const table = router({ home: '/', about: '/about' });
      `,
    });
    expect(keys(found)).toEqual([]);
    // Nothing was read and the reader says which half of it read nothing.
    expect(reasons(found)).toEqual(['procedure-members-unmatched']);
  });

  it('says so when nothing here assembles a tree at all', () => {
    const found = read({ '/server/plain.ts': 'export const answer = 42;' });
    expect(keys(found)).toEqual([]);
    expect(reasons(found)).toEqual(['procedure-trees-unmatched']);
  });

  it('is off where nothing depends on the library', () => {
    expect(trpcProceduresAdapter.detect({ dependencies: { next: '^15.0.0' } })).toBe(false);
    expect(trpcProceduresAdapter.detect({ dependencies: { '@trpc/server': '^11.0.0' } })).toBe(true);
  });
});

describe('the mount, which is read so that a file can say what it serves', () => {
  it('names the file that serves a tree, and the tree when it was followed', () => {
    const found = read({
      '/server/root.ts': `
        import { procedure, router } from './trpc';
        export const appRouter = router({ ping: procedure.query(() => 'pong') });
      `,
      '/server/adapter.ts': `
        import { createNextApiHandler as base } from '@trpc/server/adapters/next';
        export const createNextApiHandler = (router: unknown) => base({ router } as never);
      `,
      '/pages/api/trpc/[trpc].ts': `
        import { createNextApiHandler } from '../../../server/adapter';
        import { appRouter } from '../../../server/root';
        export default createNextApiHandler(appRouter);
      `,
    });
    expect(metaOf(found, 'ping')['served']).toEqual(['pages/api/trpc/[trpc].ts']);
    expect(reasons(found)).toEqual([]);
  });

  it('reports the file when the tree it serves could not be followed', () => {
    const found = read({
      '/server/factory.ts': `
        import { procedure, router } from './trpc';
        export const routerFor = (scope: string) => router({ list: procedure.query(() => [scope]) });
      `,
      '/pages/api/trpc/[trpc].ts': `
        import { createNextApiHandler } from '@trpc/server/adapters/next';
        import { routerFor } from '../../../server/factory';
        export default createNextApiHandler({ router: routerFor('daily') } as never);
      `,
    });
    const row = found.unresolved.find((each) => each.reason === 'procedure-router-unread');
    expect(row?.file).toBe('pages/api/trpc/[trpc].ts');
    expect(row?.message).toContain('pages/api/trpc/[trpc].ts');
  });

  it('reports a key nobody could name, and invents no way in for it', () => {
    const found = read({
      '/server/root.ts': `
        import { procedure, router } from './trpc';
        const name = 'list';
        export const appRouter = router({ [name]: procedure.query(() => []) });
      `,
    });
    expect(keys(found)).toEqual([]);
    expect(reasons(found)).toContain('procedure-key-dynamic');
  });
});

describe('the description, which is data rather than code', () => {
  it('ships a row that went in through the schema', () => {
    expect(TRPC.name).toBe('trpc-procedures');
    expect(TRPC.separator).toBe('.');
    expect(TRPC.terminators.get('query')).toBe('rpc');
    expect(TRPC.mounts.map((mount) => mount.call)).toContain('createNextApiHandler');
  });

  it('reads a framework nobody shipped a row for, from configuration alone', () => {
    const description = {
      name: 'zrpc-procedures',
      packages: ['zrpc'],
      assembledBy: ['makeTable'],
      terminators: { reads: 'rpc', writes: 'rpc' },
      separator: '/',
    };
    const ctx = contextFor(
      {
        '/server/zrpc.d.ts': `
          export interface Leaf { readonly _leaf: true }
          export interface Builder { reads(fn: unknown): Leaf; writes(fn: unknown): Leaf }
          export declare const step: Builder;
          export declare function makeTable(shape: Record<string, unknown>): unknown;
        `,
        '/server/table.ts': `
          import { makeTable, step } from './zrpc';
          export const table = makeTable({
            orders: makeTable({ list: step.reads(() => []) }),
          });
        `,
      },
      { zrpc: '^1.0.0' },
      [description],
    );
    const entries = configuredProceduresAdapter.extractEntries(ctx);
    expect(entries.map((entry) => entry.key)).toEqual(['orders/list']);
    expect(entries[0]?.meta?.['description']).toBe('zrpc-procedures');
  });

  it('says a description was not tried here, rather than nothing', () => {
    const ctx = contextFor({}, { next: '^15.0.0' }, [
      {
        name: 'zrpc-procedures',
        packages: ['zrpc'],
        assembledBy: ['makeTable'],
        terminators: { reads: 'rpc' },
      },
    ]);
    expect(configuredProceduresAdapter.extractEntries(ctx)).toEqual([]);
    expect(ctx.builder.build().unresolved.map((row) => row.reason)).toEqual([
      'entry-procedures-description-inactive',
    ]);
  });
});
