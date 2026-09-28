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
