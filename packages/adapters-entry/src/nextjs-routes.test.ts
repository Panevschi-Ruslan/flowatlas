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
import { APP_PAGES, APP_ROUTER, PAGES_API, routePathOfFile } from './nextjs-paths.js';
import { nextjsRoutesAdapter } from './nextjs-routes.js';

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

const extract = (
  files: Record<string, string>,
  dependencies: Record<string, string> = {},
): Read => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false, jsx: 4 },
  });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);

  const ctx: ExtractContext = {
    repo: 'shop',
    repoDir: '/',
    service: { name: 'shop', repo: '/', type: 'nextjs' },
    config: parseConfig({}),
    pkg: { dependencies: { next: '^15.0.0', ...dependencies } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'shop' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  const entries = nextjsRoutesAdapter.extractEntries(ctx);
  return { entries, unresolved: ctx.builder.build().unresolved };
};

const ids = (read: Read): string[] => read.entries.map((entry) => entry.id).sort();

describe('the address a file is served at', () => {
  it('reads a directory path as a route, with the dynamic segments as parameters', () => {
    expect(routePathOfFile('app/api/orders/route.ts', APP_ROUTER)).toBe('/api/orders');
    expect(routePathOfFile('app/api/orders/[id]/route.ts', APP_ROUTER)).toBe('/api/orders/:param');
    expect(routePathOfFile('src/app/api/orders/route.ts', APP_ROUTER)).toBe('/api/orders');
  });

  // A group organises files and adds nothing to the address. Reading it as a
  // segment would move every route under it, which is the kind of mistake that
  // reads as the other side having dropped a route.
  it('drops a grouping directory, a slot and everything under a private one', () => {
    expect(routePathOfFile('app/(admin)/api/invoices/route.ts', APP_ROUTER)).toBe('/api/invoices');
    expect(routePathOfFile('app/@modal/api/x/route.ts', APP_ROUTER)).toBe('/api/x');
    expect(routePathOfFile('app/_internal/api/x/route.ts', APP_ROUTER)).toBeNull();
  });

  it('reads both spellings of a catch-all as one', () => {
    expect(routePathOfFile('app/api/[...slug]/route.ts', APP_ROUTER)).toBe('/api/*');
    expect(routePathOfFile('app/api/[[...slug]]/route.ts', APP_ROUTER)).toBe('/api/*');
  });

  it('serves nothing from a file the router does not name', () => {
    expect(routePathOfFile('app/api/orders/helpers.ts', APP_ROUTER)).toBeNull();
    expect(routePathOfFile('lib/orders.ts', APP_ROUTER)).toBeNull();
    expect(routePathOfFile('app/orders/page.tsx', APP_ROUTER)).toBeNull();
    expect(routePathOfFile('app/orders/page.tsx', APP_PAGES)).toBe('/orders');
  });

  // The older router puts the file name in the address, with `index` standing
  // for the directory it is in — the one rule the newer one dropped.
  it('reads the older router, where the file name is the last segment', () => {
    expect(routePathOfFile('pages/api/orders.ts', PAGES_API)).toBe('/api/orders');
    expect(routePathOfFile('pages/api/orders/index.ts', PAGES_API)).toBe('/api/orders');
    expect(routePathOfFile('pages/api/orders/[id].ts', PAGES_API)).toBe('/api/orders/:param');
    expect(routePathOfFile('pages/api/_middleware.ts', PAGES_API)).toBeNull();
  });
});

describe('ways in a Next.js repository declares by where its files are', () => {
  it('runs where the framework is a dependency', () => {
    expect(nextjsRoutesAdapter.detect({ dependencies: { next: '^15.0.0' } })).toBe(true);
    expect(nextjsRoutesAdapter.detect({ dependencies: { react: '^19.0.0' } })).toBe(false);
  });

  it('makes one way in per exported verb, however the verb was written', () => {
    const read = extract({
      '/app/api/orders/route.ts': `
        export async function GET() { return null; }
        export const POST = async () => null;
      `,
    });
    expect(ids(read)).toEqual(['entry:shop:http:GET:/api/orders', 'entry:shop:http:POST:/api/orders']);
    const [first] = read.entries;
    expect(first?.handler !== undefined && isFunctionHandler(first.handler)).toBe(true);
  });

  // Aliasing and re-exporting are how a repository shares one handler between
  // two addresses, and both are common enough that missing them loses routes
  // without saying anything.
  it('follows a verb exported under another name, and a whole module re-exported', () => {
    const read = extract({
      '/app/api/auth/route.ts': `
        const handler = async () => null;
        export { handler as GET, handler as POST };
      `,
      '/app/api/auth/legacy/route.ts': `export * from '../route';`,
    });
    expect(ids(read)).toEqual([
      'entry:shop:http:GET:/api/auth',
      'entry:shop:http:GET:/api/auth/legacy',
      'entry:shop:http:POST:/api/auth',
      'entry:shop:http:POST:/api/auth/legacy',
    ]);
  });

  it('says so when a route file exports no verb it could read', () => {
    const read = extract({
      '/app/api/orders/route.ts': `
        const verbs = { GET: async () => null };
        export default verbs;
      `,
    });
    expect(read.entries).toHaveLength(0);
    expect(read.unresolved.map((row) => row.reason)).toContain('route-verb-unread');
  });

  it('reads the older router as one way in answering every verb', () => {
    const read = extract({
      '/pages/api/legacy-orders.ts': `export default async function handler() {}`,
    });
    expect(ids(read)).toEqual(['entry:shop:http:ALL:/api/legacy-orders']);
  });

  it('makes a way in of every function a module marks as a boundary', () => {
    const read = extract({
      '/app/actions/orders.ts': `
        'use server';
        export async function archiveOrder(id: string) { return id; }
        export const RETRIES = 3;
      `,
    });
    expect(ids(read)).toEqual(['entry:shop:rpc:action:app/actions/orders.ts#archiveOrder']);
    expect(read.entries[0]?.meta?.['viaImport']).toBe(true);
  });

  // In the repository this was measured against, a hundred and twenty-nine of
  // the hundred and thirty-four exported actions are built this way, so a
  // silence here would read as a repository with almost no actions in it.
  it('says so when a boundary module exports a value it cannot name a function for', () => {
    const read = extract({
      '/lib/actions/archive.ts': `
        'use server';
        import { client } from '../client';
        export const archiveOrderAction = client.schema({}).action(async () => null);
      `,
      '/lib/client.ts': `export const client = { schema: (s: unknown) => ({ action: (fn: unknown) => fn }) };`,
    });
    expect(read.entries).toHaveLength(0);
    const row = read.unresolved.find((each) => each.reason === 'server-action-unread');
    expect(row?.sites).toBe(1);
    expect(row?.symbol).toBe('lib/actions/archive.ts#archiveOrderAction');
  });

  // The dominant spelling in this ecosystem, and the one that read as nothing
  // at all until a row said which argument of which method is the action.
  it('makes a way in of an action a described builder was handed', () => {
    const read = extract(
      {
        '/app/actions/orders.ts': `
        'use server';
        import { client } from '../lib/client';
        export const archiveOrder = client.schema({}).action(async () => null);
      `,
        '/lib/client.ts': `export const client = { schema: (s: unknown) => ({ action: (fn: unknown) => fn }) };`,
      },
      { 'next-safe-action': '^8.0.0' },
    );
    expect(ids(read)).toEqual(['entry:shop:rpc:action:app/actions/orders.ts#archiveOrder']);
    const entry = read.entries[0];
    expect(entry?.kind).toBe('rpc');
    expect(entry?.label).toBe('action archiveOrder');
    expect(entry?.meta?.['viaImport']).toBe(true);
    expect(entry?.meta?.['registration']).toBe("module 'use server'");
    expect(entry?.meta?.['builder']).toBe('next-safe-action');
    expect(read.unresolved.map((row) => row.reason)).not.toContain('server-action-unread');
  });

  it('points at the function a builder was handed by name', () => {
    const read = extract(
      {
        '/app/actions/orders.ts': `
        'use server';
        import { client } from '../lib/client';
        const renameOrderAction = async () => null;
        export const renameOrder = client.schema({}).action(renameOrderAction);
      `,
        '/lib/client.ts': `export const client = { schema: (s: unknown) => ({ action: (fn: unknown) => fn }) };`,
      },
      { 'next-safe-action': '^8.0.0' },
    );
    const handler = read.entries[0]?.handler;
    expect(handler !== undefined && isFunctionHandler(handler) ? handler.functionName : undefined).toBe(
      'renameOrderAction',
    );
    expect(read.entries[0]?.meta?.['handlerVia']).toBe('function');
  });

  // A second library was a row and nothing else, which is the whole claim the
  // description makes about itself.
  it('reads a second library from its own row', () => {
    const read = extract(
      {
        '/app/actions/orders.ts': `
        'use server';
        import { server } from '../lib/server';
        export const exportOrders = server.input({}).handler(async () => null);
      `,
        '/lib/server.ts': `export const server = { input: (s: unknown) => ({ handler: (fn: unknown) => fn }) };`,
      },
      { zsa: '^0.5.0' },
    );
    expect(ids(read)).toEqual(['entry:shop:rpc:action:app/actions/orders.ts#exportOrders']);
  });

  // The library is described, the method is not, so nothing about the call says
  // where the action is and guessing would put a boundary where none exists.
  it('leaves a method no row names to the aggregate row', () => {
    const read = extract(
      {
        '/app/actions/orders.ts': `
        'use server';
        import { client } from '../lib/client';
        export const archiveOrder = client.wrap(async () => null);
      `,
        '/lib/client.ts': `export const client = { wrap: (fn: unknown) => fn };`,
      },
      { 'next-safe-action': '^8.0.0' },
    );
    expect(read.entries).toHaveLength(0);
    expect(read.unresolved.map((row) => row.reason)).toContain('server-action-unread');
  });

  it('leaves a described method handed a value rather than a function alone', () => {
    const read = extract(
      {
        '/app/actions/orders.ts': `
        'use server';
        import { client } from '../lib/client';
        export const limits = client.schema({}).action(3);
      `,
        '/lib/client.ts': `export const client = { schema: (s: unknown) => ({ action: (fn: unknown) => fn }) };`,
      },
      { 'next-safe-action': '^8.0.0' },
    );
    expect(read.entries).toHaveLength(0);
    expect(read.unresolved.map((row) => row.reason)).toContain('server-action-unread');
  });

  it('makes a way in of one function that marks itself, in a module that is not marked', () => {
    const read = extract({
      '/lib/orders.ts': `
        export async function archiveOrder(id: string) {
          'use server';
          return id;
        }
        export async function listOrders() { return []; }
      `,
    });
    expect(ids(read)).toEqual(['entry:shop:rpc:action:lib/orders.ts#archiveOrder']);
  });

  it('names the middleware in front of the routes its matcher covers', () => {
    const read = extract({
      '/middleware.ts': `
        export const config = { matcher: ['/api/:path*'] };
        export function middleware() { return undefined; }
      `,
      '/app/api/orders/route.ts': `export async function GET() { return null; }`,
      '/app/health/route.ts': `export async function GET() { return null; }`,
    });
    const guarded = read.entries.find((entry) => entry.meta?.['path'] === '/api/orders');
    const open = read.entries.find((entry) => entry.meta?.['path'] === '/health');
    expect(guarded?.meta?.['middleware']).toEqual(['middleware.ts']);
    expect(open?.meta?.['middleware']).toBeUndefined();
  });

  // A matcher written as a regular expression is the framework's own example,
  // and claiming the routes behind it are guarded because an expression nobody
  // read might have matched them is the worst thing this could say.
  it('claims nothing about a matcher it could not read, and says why', () => {
    const read = extract({
      '/middleware.ts': `
        export const config = { matcher: ['/((?!api|_next).*)'] };
        export function middleware() { return undefined; }
      `,
      '/app/api/orders/route.ts': `export async function GET() { return null; }`,
    });
    expect(read.entries[0]?.meta?.['middleware']).toBeUndefined();
    expect(read.unresolved.map((row) => row.reason)).toContain('middleware-matcher-unread');
  });

  it('puts everything behind a middleware that declares no matcher at all', () => {
    const read = extract({
      '/middleware.ts': `export function middleware() { return undefined; }`,
      '/app/api/orders/route.ts': `export async function GET() { return null; }`,
    });
    expect(read.entries[0]?.meta?.['middleware']).toEqual(['middleware.ts']);
  });
});
