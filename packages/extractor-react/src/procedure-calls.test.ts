import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type ExtractContext,
  type GraphNode,
  type RepoGraph,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** Reads a repository written in memory that depends on the packages named. */
const read = (files: Record<string, string>, dependencies: Record<string, string>): RepoGraph => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false, jsx: 4 },
  });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react' },
    config: parseConfig({}),
    pkg: { dependencies: { react: '^19.0.0', ...dependencies } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
    meta: {},
  };
  extractReact(ctx, { noTypes: true });
  return builder.build();
};

const CLIENT = { '@trpc/client': '^11.0.0' };
const REACT = { '@trpc/react-query': '^11.0.0' };

const procedureCalls = (graph: RepoGraph): GraphNode[] =>
  graph.nodes.filter((node) => node.type === 'ui_api_call' && node.kind === 'rpc');

const byProcedure = (graph: RepoGraph): Record<string, unknown> =>
  Object.fromEntries(
    procedureCalls(graph).map((node) => [String(node.meta?.['procedure']), node.meta?.['call']]),
  );

describe('a procedure a client asks for', () => {
  it('is a request carrying the path and what the call does', () => {
    const graph = read(
      {
        '/src/client.ts': `
          import { createTRPCClient, httpBatchLink } from '@trpc/client';
          export const client = createTRPCClient<any>({ links: [httpBatchLink({ url: '/api/trpc' })] });
        `,
        '/src/orders.ts': `
          import { client } from './client';
          export const listOrdersFor = (customerId: string) => client.orders.list.query({ customerId });
          export const createOrderOf = (sku: string) => client.orders.create.mutate({ sku });
        `,
      },
      CLIENT,
    );
    expect(byProcedure(graph)).toEqual({ 'orders.list': 'query', 'orders.create': 'mutation' });
    const list = procedureCalls(graph).find((node) => node.meta?.['procedure'] === 'orders.list');
    expect(list?.label).toBe('rpc orders.list');
    expect(list?.meta?.['operation']).toBe('query');
    expect(list?.meta?.['inputKeys']).toEqual(['customerId']);
    // The function the call is written in reaches it, which is what makes it a caller.
    expect(
      graph.edges.some(
        (edge) =>
          edge.from === 'web#src/orders.ts:listOrdersFor' && edge.to === list?.id && edge.type === 'calls',
      ),
    ).toBe(true);
  });

  it('reads the hooks, and a hook whose input is handed over later', () => {
    const graph = read(
      {
        '/src/trpc.ts': `
          import { createTRPCReact } from '@trpc/react-query';
          export const trpc = createTRPCReact<any>();
        `,
        '/src/Orders.tsx': `
          import { trpc } from './trpc';
          export function Orders() {
            const orders = trpc.orders.list.useQuery({ customerId: 'c' });
            const create = trpc.orders.create.useMutation();
            const daily = trpc.reportsRouter.daily.useSuspenseQuery();
            return <button onClick={() => create.mutate({ sku: 'a' })}>{String(orders.data)}{String(daily)}</button>;
          }
        `,
      },
      REACT,
    );
    expect(byProcedure(graph)).toEqual({
      'orders.list': 'query',
      'orders.create': 'mutation',
      'reportsRouter.daily': 'query',
    });
    // `create.mutate(…)` is the hook's result being used, not a second proxy:
    // `create` is not made by anything the description names.
    expect(procedureCalls(graph)).toHaveLength(3);
  });

  it('reads a proxy a hook hands back inside the component', () => {
    const graph = read(
      {
        '/src/trpc.ts': `
          import { createTRPCContext } from '@trpc/tanstack-react-query';
          export const { TRPCProvider, useTRPC } = createTRPCContext<any>();
        `,
        '/src/Daily.tsx': `
          import { useTRPC } from './trpc';
          export function Daily() {
            const trpc = useTRPC();
            const options = trpc.reports.daily.queryOptions({ day: '2026-01-01' });
            return <div>{String(options)}</div>;
          }
        `,
      },
      { '@trpc/tanstack-react-query': '^11.0.0' },
    );
    expect(byProcedure(graph)).toEqual({ 'reports.daily': 'query' });
  });

  it('says so when a step of the path is computed', () => {
    const graph = read(
      {
        '/src/orders.ts': `
          import { createTRPCClient } from '@trpc/client';
          const client = createTRPCClient<any>({ links: [] });
          export const listFor = (section: string) => client[section].list.query();
        `,
      },
      CLIENT,
    );
    const [call] = procedureCalls(graph);
    expect(call?.meta?.['procedure']).toBeNull();
    expect(graph.unresolved.map((row) => row.reason)).toContain('procedure-path-dynamic');
  });

  it('reads nothing where no client package is installed, whatever the spelling', () => {
    const graph = read(
      {
        '/src/orders.ts': `
          const createTRPCClient = (_: unknown) => ({}) as any;
          const client = createTRPCClient({});
          export const listOrders = () => client.orders.list.query();
        `,
      },
      {},
    );
    expect(procedureCalls(graph)).toEqual([]);
  });

  it('does not read a value that was not made by a proxy factory', () => {
    const graph = read(
      {
        '/src/orders.ts': `
          const store = { orders: { list: { query: () => [] } } };
          export const listOrders = () => store.orders.list.query();
        `,
      },
      CLIENT,
    );
    expect(procedureCalls(graph)).toEqual([]);
  });
});

const ORPC = { '@orpc/client': '^1.0.0', '@orpc/tanstack-query': '^1.0.0' };

const ORPC_CLIENT_FILE = `
  import { createORPCClient } from '@orpc/client';
  import { RPCLink } from '@orpc/client/fetch';
  import { createTanstackQueryUtils } from '@orpc/tanstack-query';
  const link = new RPCLink({ url: \`\${import.meta.env.VITE_API_URL}/rpc\` });
  export const client = createORPCClient<any>(link);
  export const orpc = createTanstackQueryUtils(client);
`;

const requestFor = (graph: RepoGraph, procedure: string): GraphNode | undefined =>
  procedureCalls(graph).find((node) => node.meta?.['procedure'] === procedure);

describe('an oRPC procedure a client asks for (P58)', () => {
  const graph = read(
    {
      '/src/orpc.ts': ORPC_CLIENT_FILE,
      '/src/Orders.tsx': `
        import { useQuery, useMutation } from '@tanstack/react-query';
        import { client, orpc } from './orpc';
        export function Orders() {
          const orders = useQuery(orpc.orders.list.queryOptions({ input: { status: 'open' } }));
          const place = useMutation(orpc.orders.place.mutationOptions());
          const key = orpc.orders.list.key();
          return <button onClick={() => place.mutate({ sku: 'a' })}>{String(orders.data)}{String(key)}</button>;
        }
        export const cancel = (id: string) => client.orders.cancel({ id });
      `,
    },
    ORPC,
  );

  it('is a request for the procedure whose path is called, or whose options are built', () => {
    expect(byProcedure(graph)).toEqual({ 'orders.list': 'handler', 'orders.place': 'handler', 'orders.cancel': 'handler' });
    expect(requestFor(graph, 'orders.cancel')?.meta?.['operation']).toBe('call');
    expect(requestFor(graph, 'orders.list')?.meta?.['operation']).toBe('queryOptions');
  });

  it('reads the input under its key in the options', () => {
    expect(requestFor(graph, 'orders.list')?.meta?.['inputKeys']).toEqual(['status']);
    expect(requestFor(graph, 'orders.cancel')?.meta?.['inputKeys']).toEqual(['id']);
  });

  it('reads where the link sends, through the proxy the utilities were made from', () => {
    expect(requestFor(graph, 'orders.list')?.meta?.['link']).toEqual({ protocol: 'rpc', path: '/rpc', baseUrlEnv: 'VITE_API_URL' });
    expect(requestFor(graph, 'orders.cancel')?.meta?.['link']).toEqual({ protocol: 'rpc', path: '/rpc', baseUrlEnv: 'VITE_API_URL' });
  });

  it('says so when the link works its address out per request', () => {
    const dynamic = read(
      {
        '/src/orpc.ts': `
          import { createORPCClient } from '@orpc/client';
          import { RPCLink } from '@orpc/client/fetch';
          export const client = createORPCClient<any>(new RPCLink({ url: () => window.location.origin + '/rpc' }));
          export const list = () => client.orders.list();
        `,
      },
      ORPC,
    );
    expect(requestFor(dynamic, 'orders.list')?.meta?.['link']).toEqual({ protocol: 'rpc', dynamic: true });
    expect(dynamic.unresolved.map((row) => row.reason)).toEqual(['procedure-link-dynamic']);
  });

  it('names the declaration a server-side call reaches, through the tree it was made from', () => {
    const server = read(
      {
        '/src/orders.ts': `
          import { os } from '@orpc/server';
          export const getOrder = os
            .handler(async () => ({ id: 'o-1' }));
          export const ordersRouter = os.router({ get: getOrder });
        `,
        '/src/router.ts': `
          import { ordersRouter } from './orders';
          export const router = { orders: ordersRouter };
        `,
        '/src/page.tsx': `
          import { call, createRouterClient } from '@orpc/server';
          import { router } from './router';
          import { getOrder, ordersRouter } from './orders';
          const caller = createRouterClient(router);
          export const viaClient = () => caller.orders.get({ id: 'o-1' });
          export const viaCall = () => call(getOrder, { id: 'o-1' });
          export const viaBranch = () => call(ordersRouter.get, { id: 'o-1' });
        `,
      },
      { '@orpc/server': '^1.0.0' },
    );
    const calls = procedureCalls(server);
    expect(calls).toHaveLength(3);
    expect(calls.every((node) => node.meta?.['procedureAt'] === 'src/orders.ts:3')).toBe(true);
    expect(calls.every((node) => node.meta?.['inProcess'] === true)).toBe(true);
    expect(calls.map((node) => String(node.meta?.['procedure'])).sort()).toEqual(['get', 'null', 'orders.get']);
    expect(server.unresolved).toEqual([]);
  });
});

