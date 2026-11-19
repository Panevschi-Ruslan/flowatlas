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
import { ORPC } from './procedure-dialects.js';
import { orpcProceduresAdapter } from './procedure-routers.js';

/**
 * The library, shaped as the reading depends on it (P58).
 *
 * A builder's every link returns another builder and only `handler` ends one,
 * `router` hands back what it was given, and `implement` hands back something
 * nothing here can type - which is what a contract's implementer is in a clone
 * nobody installed.
 */
const ORPC_SERVER = `
export interface Procedure { readonly _procedure: true }
export type Handler = (opts: { input: any; context: any; errors: any }) => unknown;
export interface Builder {
  $context<C>(): Builder;
  input(schema: unknown): Builder;
  output(schema: unknown): Builder;
  use(middleware: unknown): Builder;
  errors(map: Record<string, unknown>): Builder;
  route(route: { method?: string; path?: string }): Builder;
  prefix(prefix: string): Builder;
  router<T>(router: T): T;
  handler(fn: Handler): Procedure;
}
export declare const os: Builder;
export declare function implement<T>(contract: T): any;
export declare function lazy<T>(load: () => Promise<{ default: T }>): T;
export declare class ORPCError { constructor(code: string, options?: unknown) }
`;

const ORPC_FETCH = `
export declare class RPCHandler {
  constructor(router: unknown, options?: unknown);
  handle(request: Request, options?: { prefix?: string; context?: unknown }): Promise<{ matched: boolean; response?: Response }>;
}
`;

const OPENAPI_FETCH = `
export declare class OpenAPIHandler {
  constructor(router: unknown, options?: unknown);
  handle(request: Request, options?: { prefix?: string; context?: unknown }): Promise<{ matched: boolean; response?: Response }>;
}
`;

const ORPC_CONTRACT = `
export interface ContractBuilder {
  route(route: { method?: string; path?: string }): ContractBuilder;
  input(schema: unknown): ContractBuilder;
  output(schema: unknown): ContractBuilder;
  errors(map: Record<string, unknown>): ContractBuilder;
  prefix(prefix: string): ContractBuilder;
  router<T>(router: T): T;
}
export declare const oc: ContractBuilder;
`;

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

const read = (
  files: Record<string, string>,
  dependencies: Record<string, string> = { '@orpc/server': '^1.0.0' },
): Read => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  project.createSourceFile('/node_modules/@orpc/server/index.d.ts', ORPC_SERVER);
  project.createSourceFile('/node_modules/@orpc/server/fetch.d.ts', ORPC_FETCH);
  project.createSourceFile('/node_modules/@orpc/openapi/fetch.d.ts', OPENAPI_FETCH);
  project.createSourceFile('/node_modules/@orpc/contract/index.d.ts', ORPC_CONTRACT);
  project.createSourceFile('/schemas.ts', 'export const OrderQuery = { _output: { status: "" } };\nexport const OrderList = { _output: [] as { id: string }[] };\n');
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const ctx: ExtractContext = {
    repo: 'api',
    repoDir: '/',
    service: { name: 'api', repo: '/', type: 'nextjs' },
    config: parseConfig({}),
    pkg: { dependencies },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return { entries: orpcProceduresAdapter.extractEntries(ctx), unresolved: ctx.builder.build().unresolved };
};

const keysOf = (found: Read, kind: string): string[] =>
  found.entries.filter((entry) => entry.kind === kind).map((entry) => entry.key).sort();
const entryAt = (found: Read, key: string): EntryNode | undefined => found.entries.find((entry) => entry.key === key);
const metaOf = (found: Read, key: string): Record<string, unknown> => (entryAt(found, key)?.meta ?? {}) as Record<string, unknown>;
const guardsOf = (found: Read, key: string): string[] | undefined => entryAt(found, key)?.wrapping?.map((guard) => guard.label);
const reasons = (found: Read): string[] => found.unresolved.map((row) => row.reason).sort();

const ORDERS = `
import { os } from '@orpc/server';
import { OrderQuery } from '../schemas';
function requireUser({ next }: any) { return next(); }
const authed = os.$context<{ user?: string }>().use(requireUser).errors({ UNAUTHORIZED: {} });
export const listOrders = authed.route({ method: 'get', path: '/orders' }).input(OrderQuery).handler(async ({ input }) => []);
export const getOrder = authed
  .route({ method: 'GET', path: '/orders/{id}' })
  .errors({ NOT_FOUND: {}, RATE_LIMITED: { status: 429 } })
  .handler(async () => ({ id: 'o-1' }));
export const placeOrder = os.handler(async () => ({ id: 'o-2' }));
`;

const ROUTER = `
import { os } from '@orpc/server';
import { getOrder, listOrders, placeOrder } from './orders';
function audit({ next }: any) { return next(); }
export const router = {
  orders: os.use(audit).prefix('/v1').router({ list: listOrders, get: getOrder }),
  place: placeOrder,
  health: { ping: os.handler(() => 'pong') },
};
`;

const MOUNT = `
import { RPCHandler } from '@orpc/server/fetch';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { router } from '../server/router';
const rpc = new RPCHandler(router);
const rest = new OpenAPIHandler(router);
export async function handle(request: Request) {
  const answered = await rpc.handle(request, { prefix: '/rpc', context: {} });
  if (answered.matched) return answered.response;
  return (await rest.handle(request, { prefix: '/api/' })).response;
}
`;

describe('oRPC procedures (P58)', () => {
  const found = read({ '/server/orders.ts': ORDERS, '/server/router.ts': ROUTER, '/app/handle.ts': MOUNT });

  it('reads a plain object as a tree, with os.router inside it', () => {
    expect(keysOf(found, 'rpc')).toEqual(['health.ping', 'orders.get', 'orders.list', 'place']);
    expect(metaOf(found, 'orders.list')['call']).toBe('handler');
    expect(metaOf(found, 'place')['registration']).toBe('{ … }');
  });

  it('puts what a router call installs in front of every procedure under it, before their own', () => {
    expect(guardsOf(found, 'orders.list')).toEqual(['audit', 'requireUser']);
    expect(guardsOf(found, 'place')).toBeUndefined();
  });

  it('records the input and output, the declared errors with their statuses, and the route', () => {
    expect(metaOf(found, 'orders.list')['input']).toBe('OrderQuery');
    expect(metaOf(found, 'orders.list')['route']).toEqual({ method: 'GET', path: '/orders' });
    expect(metaOf(found, 'orders.get')['errors']).toEqual([
      { code: 'NOT_FOUND' },
      { code: 'RATE_LIMITED', status: 429 },
      { code: 'UNAUTHORIZED' },
    ]);
  });

  it('says where each procedure is mounted, and under which prefix', () => {
    expect(metaOf(found, 'place')['mounted']).toEqual([
      { protocol: 'rpc', prefix: '/rpc', file: 'app/handle.ts' },
      { protocol: 'openapi', prefix: '/api', file: 'app/handle.ts' },
    ]);
    expect(metaOf(found, 'place')['served']).toEqual(['app/handle.ts']);
  });

  it('makes every procedure an OpenAPI handler serves an HTTP route too, at its route or its keys', () => {
    expect(keysOf(found, 'http')).toEqual([
      'GET:/api/v1/orders',
      'GET:/api/v1/orders/:param',
      'POST:/api/health/ping',
      'POST:/api/place',
    ]);
    const route = entryAt(found, 'GET:/api/v1/orders/:param');
    expect(route?.meta?.['procedure']).toBe('orders.get');
    expect(route?.meta?.['rawPath']).toBe('/api/v1/orders/{id}');
    expect(route?.wrapping?.map((guard) => guard.label)).toEqual(['audit', 'requireUser']);
    expect(route?.file).toBe(entryAt(found, 'orders.get')?.file);
  });

  it('says nothing about the plain literals that are not trees', () => {
    expect(reasons(found)).toEqual([]);
  });

  it('is told apart from a repository with literals and no procedure', () => {
    const none = read({ '/server/config.ts': 'export const config = { port: 3000, db: { url: "x" } };' });
    expect(none.entries).toEqual([]);
    expect(reasons(none)).toEqual(['procedure-trees-unmatched']);
  });

  it('reads input, output, errors and route off the contract an implementation names', () => {
    const contract = read({
      '/contract/index.ts': `
        import { oc } from '@orpc/contract';
        import { OrderList, OrderQuery } from '../schemas';
        export const contract = {
          orders: oc.prefix('/shop').router({
            list: oc.route({ method: 'GET', path: '/orders' }).input(OrderQuery).output(OrderList),
            cancel: oc.route({ method: 'DELETE', path: '/orders/{id}' }).errors({ CONFLICT: {} }),
          }),
        };
      `,
      '/server/impl.ts': `
        import { implement } from '@orpc/server';
        import { contract } from '../contract';
        function requireUser({ next }: any) { return next(); }
        const os = implement(contract).$context<{ user: string }>().use(requireUser);
        export const router = os.router({
          orders: {
            list: os.orders.list.handler(async ({ input }) => []),
            cancel: os.orders.cancel.handler(async () => ({})),
            refund: os.orders.refund.handler(async () => ({})),
          },
        });
      `,
    });
    expect(keysOf(contract, 'rpc')).toEqual(['orders.cancel', 'orders.list', 'orders.refund']);
    expect(metaOf(contract, 'orders.list')).toMatchObject({ input: 'OrderQuery', output: 'OrderList', route: { method: 'GET', path: '/shop/orders' } });
    expect(metaOf(contract, 'orders.cancel')['errors']).toEqual([{ code: 'CONFLICT' }]);
    expect(guardsOf(contract, 'orders.list')).toEqual(['requireUser']);
    expect(reasons(contract)).toEqual(['procedure-contract-unread']);
    expect(contract.unresolved[0]?.symbol).toBe('orders.refund');
  });

  it('says so when the prefix a mount answers under cannot be read', () => {
    const unread = read({
      '/server/orders.ts': ORDERS,
      '/server/router.ts': ROUTER,
      '/app/handle.ts': `
        import { RPCHandler } from '@orpc/server/fetch';
        import { OpenAPIHandler } from '@orpc/openapi/fetch';
        import { router } from '../server/router';
        export const rpc = new RPCHandler(router);
        const rest = new OpenAPIHandler(router);
        const base = process.env.BASE;
        export const handle = (request: Request) => rest.handle(request, { prefix: base });
      `,
    });
    expect(keysOf(unread, 'http')).toEqual([]);
    expect(unread.unresolved.map((row) => [row.reason, row.level ?? 'action'])).toEqual([
      ['procedure-prefix-unread', 'info'],
      ['procedure-prefix-unread', 'action'],
    ]);
  });

  /**
   * A lazy branch whose `import()` the checker cannot resolve (P252): an
   * alias with no `paths` behind it. Followed by its path where one file of
   * the service fits; where none does, a row that says it is a lazy branch,
   * and the module's own tree is not read as a root of its own.
   */
  describe('a lazy branch the checker cannot resolve (P252)', () => {
    const REPORTS = `
      import { os } from '@orpc/server';
      export default { summary: os.handler(async () => ({ total: 0 })) };
    `;
    const routerLoading = (written: string): string => `
      import { lazy, os } from '@orpc/server';
      export const router = { health: os.handler(() => 'ok'), reports: lazy(() => import('${written}')) };
    `;

    it('follows an alias to the one file of the service its path names', () => {
      const aliased = read({ '/server/router.ts': routerLoading('@/server/reports'), '/server/reports.ts': REPORTS });
      expect(keysOf(aliased, 'rpc')).toEqual(['health', 'reports.summary']);
      expect(reasons(aliased)).toEqual([]);
    });

    it('follows a relative path written with the ending the bundler resolves', () => {
      const relative = read({ '/server/router.ts': routerLoading('./reports/index.js'), '/server/reports/index.ts': REPORTS });
      expect(keysOf(relative, 'rpc')).toEqual(['health', 'reports.summary']);
    });

    it('says a branch it cannot follow is a lazy branch, and does not read the module it names as a root', () => {
      const unread = read({ '/server/router.ts': routerLoading('@lib/reports'), '/server/reports.ts': REPORTS });
      expect(keysOf(unread, 'rpc')).toEqual(['health']);
      expect(unread.unresolved.map((row) => [row.reason, row.symbol])).toEqual([['procedure-branch-unread', 'reports']]);
      expect(unread.unresolved[0]?.message).toContain('loads its tree lazily from @lib/reports');
      expect(unread.unresolved[0]?.message).toContain('the tree server/reports.ts exports by default may be it, and is not read as a root of its own');
    });

    it('says a branch whose module is nowhere is a lazy branch, and reads nothing else as its tree', () => {
      const missing = read({ '/server/router.ts': routerLoading('./missing') });
      expect(keysOf(missing, 'rpc')).toEqual(['health']);
      expect(missing.unresolved.map((row) => row.reason)).toEqual(['procedure-branch-unread']);
      expect(missing.unresolved[0]?.message).toContain('loads its tree lazily from ./missing');
      expect(missing.unresolved[0]?.message).not.toContain('may be it');
    });
  });

  it('ships a row that went in through the schema', () => {
    expect(ORPC.terminators.get('handler')).toBe('rpc');
    expect(ORPC.plainTrees).toBe(true);
    expect(ORPC.mounts.every((mount) => mount.constructed)).toBe(true);
  });
});
