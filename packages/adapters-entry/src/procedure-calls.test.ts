import { GraphBuilder, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { Node, Project, type Node as TsNode } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { readProcedureCalls, type LinkAddress, type ProcedureCallReading } from './procedure-calls.js';

/**
 * An address reader just wide enough for these tests: an absolute URL written
 * as text, or a template rooted at `process.env.X`. Each half of the reading
 * hands the reader its own; what is under test is what the reader does with
 * the answer, not how an address is read.
 */
const addressOf = (url: TsNode): LinkAddress => {
  if (Node.isStringLiteral(url) || Node.isNoSubstitutionTemplateLiteral(url)) {
    const match = /^[a-z]+:\/\/([^/]+)(.*)$/.exec(url.getLiteralText());
    return match === null
      ? { path: url.getLiteralText(), baseUrlEnv: null, host: null }
      : { path: match[2] === '' ? '/' : (match[2] ?? '/'), baseUrlEnv: null, host: match[1] ?? null };
  }
  if (Node.isTemplateExpression(url) && url.getHead().getLiteralText() === '') {
    const [span] = url.getTemplateSpans();
    const env = /^process\.env\.(\w+)$/.exec(span?.getExpression().getText() ?? '');
    if (env !== null && span !== undefined) return { path: span.getLiteral().getLiteralText(), baseUrlEnv: env[1] ?? null, host: null };
  }
  return { path: null, baseUrlEnv: null, host: null };
};

const TRPC = { '@trpc/client': '^11.0.0' };
const ORPC = { '@orpc/client': '^1.0.0' };

/** Reads a repository written in memory as a server's half reads it: every file is one body. */
const read = (
  files: Record<string, string>,
  dependencies: Record<string, string>,
  options: Partial<Pick<ProcedureCallReading, 'type' | 'readAlready'>> = {},
): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, experimentalDecorators: true } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'worker' });
  const fileOf = (node: TsNode): string => node.getSourceFile().getFilePath().slice(1);
  // Every function is a body, as the readers' own walks hand them over.
  const holders = project
    .getSourceFiles()
    .flatMap((source) => source.getDescendants())
    .filter((node) => Node.isArrowFunction(node) || Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node))
    .map((fn) => {
      const id = `worker#${fileOf(fn)}:${fn.getStartLineNumber()}`;
      return {
        body: (fn as unknown as { getBody(): TsNode | undefined }).getBody(),
        id,
        file: fileOf(fn),
        ensure: () => {
          builder.addNode({ id, type: 'function', label: id, repo: 'worker' });
        },
      };
    });
  readProcedureCalls(
    holders,
    {
      repo: 'worker',
      pkg: { dependencies },
      builder,
      type: options.type ?? 'http_out',
      sources: () => project.getSourceFiles(),
      fileOf,
      addressOf,
      report: (row) => builder.addUnresolved(row),
      ...(options.readAlready === undefined ? {} : { readAlready: options.readAlready }),
    },
  );
  return builder.build();
};

const requests = (graph: RepoGraph): GraphNode[] => graph.nodes.filter((node) => node.kind === 'rpc');
const requestFor = (graph: RepoGraph, procedure: string): GraphNode | undefined =>
  requests(graph).find((node) => node.meta?.['procedure'] === procedure);

describe("a tRPC client's chain of links (P242)", () => {
  it('sends where its last link sends, stepping over the links in front', () => {
    const graph = read(
      {
        '/src/billing.ts': `
          import { createTRPCClient, httpBatchLink, loggerLink } from '@trpc/client';
          const billing = createTRPCClient<any>({ links: [loggerLink(), httpBatchLink({ url: \`\${process.env.BILLING_URL}/trpc\` })] });
          export const invoice = (orderId: string) => billing.invoices.create.mutate({ orderId });
        `,
      },
      TRPC,
    );
    const request = requestFor(graph, 'invoices.create');
    expect(request?.type).toBe('http_out');
    expect(request?.meta?.['call']).toBe('mutation');
    expect(request?.meta?.['link']).toEqual({ protocol: 'trpc', path: '/trpc', baseUrlEnv: 'BILLING_URL' });
    expect(graph.unresolved).toEqual([]);
  });

  it("sends a query down the split's HTTP branch and a subscription over its socket, and says so", () => {
    const graph = read(
      {
        '/src/billing.ts': `
          import { createTRPCClient, createWSClient, httpBatchLink, splitLink, wsLink } from '@trpc/client';
          const http = httpBatchLink({ url: 'http://billing.internal/trpc' });
          const billing = createTRPCClient<any>({
            links: [splitLink({ condition: (op) => op.type === 'subscription', true: wsLink({ client: createWSClient({ url: 'ws://billing.internal' }) }), false: http })],
          });
          export const byOrder = (orderId: string) => billing.invoices.byOrder.query({ orderId });
          export const paid = () => billing.invoices.paid.subscribe(undefined, {});
        `,
      },
      TRPC,
    );
    expect(requestFor(graph, 'invoices.byOrder')?.meta?.['link']).toEqual({ protocol: 'trpc', path: '/trpc', host: 'billing.internal' });
    expect(requestFor(graph, 'invoices.paid')?.meta?.['link']).toEqual({ protocol: 'websocket', socket: true });
    expect(graph.unresolved.map((row) => row.reason)).toEqual(['procedure-link-socket']);
  });

  it('says why where the branches of a split send to two addresses', () => {
    const graph = read(
      {
        '/src/billing.ts': `
          import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
          const billing = createTRPCClient<any>({
            links: [splitLink({ condition: () => true, true: httpLink({ url: 'http://billing.internal/trpc' }), false: [httpBatchLink({ url: 'http://ledger.internal/trpc' })] })],
          });
          export const byOrder = () => billing.invoices.byOrder.query({});
        `,
      },
      TRPC,
    );
    expect(requestFor(graph, 'invoices.byOrder')?.meta?.['link']).toEqual({ protocol: 'trpc', dynamic: true });
    const [row] = graph.unresolved;
    expect(row?.reason).toBe('procedure-link-dynamic');
    expect(row?.message).toContain('send to different addresses');
  });

  it('says why where the last link is one it does not read', () => {
    const graph = read(
      {
        '/src/billing.ts': `
          import { createTRPCClient } from '@trpc/client';
          import { customLink } from './custom';
          const billing = createTRPCClient<any>({ links: [customLink()] });
          export const byOrder = () => billing.invoices.byOrder.query({});
        `,
        '/src/custom.ts': 'export const customLink = () => ({});',
      },
      TRPC,
    );
    expect(graph.unresolved.map((row) => row.message)).toEqual([
      'invoices.byOrder is sent through a link whose address cannot be read: its last link, customLink(), is not one this reads, so the service it reaches is the one apiTarget names.',
    ]);
  });

  it("reads the untyped client's path from the text it is handed", () => {
    const graph = read(
      {
        '/src/payments.ts': `
          import { createTRPCUntypedClient, httpLink } from '@trpc/client';
          const ROUTE = 'invoices.refund';
          const payments = createTRPCUntypedClient({ links: [httpLink({ url: 'http://billing.internal/trpc' })] });
          export const refund = (invoiceId: string) => payments.mutation(ROUTE, { invoiceId });
          export const any = (path: string) => payments.query(path);
        `,
      },
      TRPC,
    );
    const refund = requestFor(graph, 'invoices.refund');
    expect(refund?.meta).toMatchObject({ call: 'mutation', operation: 'mutation', inputKeys: ['invoiceId'] });
    expect(refund?.meta?.['link']).toEqual({ protocol: 'trpc', path: '/trpc', host: 'billing.internal' });
    expect(graph.unresolved.map((row) => row.reason)).toEqual(['procedure-path-dynamic']);
  });
});

describe("a server's client held on a class (P242)", () => {
  it('is read from the member it is kept in, initialised in place or in the constructor', () => {
    const graph = read(
      {
        '/src/clients.ts': `
          import { createORPCClient } from '@orpc/client';
          import { RPCLink } from '@orpc/client/fetch';
          export class OrdersClient {
            private readonly orders = createORPCClient<any>(new RPCLink({ url: \`\${process.env.ORDERS_URL}/rpc\` }));
            place(sku: string) { return this.orders.orders.place({ sku }); }
          }
          export class AuditClient {
            private readonly audit: any;
            constructor() { this.audit = createORPCClient<any>(new RPCLink({ url: 'http://audit.internal/rpc' })); }
            record(id: string) { return this.audit.entries.record({ id }); }
            other() { return this.unrelated.entries.record({}); }
            private readonly unrelated = { entries: { record: (_: unknown) => null } };
          }
        `,
      },
      ORPC,
    );
    expect(requests(graph).map((node) => node.meta?.['procedure']).sort()).toEqual(['entries.record', 'orders.place']);
    expect(requestFor(graph, 'orders.place')?.meta?.['link']).toEqual({ protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ORDERS_URL' });
    expect(requestFor(graph, 'entries.record')?.meta?.['link']).toEqual({ protocol: 'rpc', path: '/rpc', host: 'audit.internal' });
  });

  it('leaves alone a call the browser half already recorded', () => {
    const graph = read(
      {
        '/src/orders.ts': `
          import { createORPCClient } from '@orpc/client';
          import { RPCLink } from '@orpc/client/fetch';
          const client = createORPCClient<any>(new RPCLink({ url: '/rpc' }));
          export const place = () => client.orders.place({});
        `,
      },
      ORPC,
      { readAlready: () => true },
    );
    expect(requests(graph)).toEqual([]);
  });
});

describe('a proxy whose factory is handed no link (P242)', () => {
  const hooks = (links: string): RepoGraph =>
    read(
      {
        '/src/trpc.ts': `
          import { createTRPCReact } from '@trpc/react-query';
          import { httpBatchLink } from '@trpc/client';
          export const trpc = createTRPCReact<any>();
          export const client = trpc.createClient({ links: [${links}] });
        `,
        '/src/orders.ts': `
          import { trpc } from './trpc';
          export const useOrders = () => trpc.orders.list.useQuery({});
        `,
      },
      { '@trpc/react-query': '^11.0.0', ...TRPC },
      { type: 'ui_api_call' },
    );

  it("sends where the repository's one address is, and says it was read there", () => {
    expect(requestFor(hooks(`httpBatchLink({ url: '/api/trpc' })`), 'orders.list')?.meta?.['link']).toEqual({
      protocol: 'trpc',
      path: '/api/trpc',
      from: 'repository',
    });
  });

  it('chooses none where the repository sends to two, and says the provider decides', () => {
    const two = read(
      {
        '/src/trpc.ts': `
          import { createTRPCReact } from '@trpc/react-query';
          import { httpBatchLink } from '@trpc/client';
          export const trpc = createTRPCReact<any>();
          export const shop = trpc.createClient({ links: [httpBatchLink({ url: '/api/trpc' })] });
          export const admin = trpc.createClient({ links: [httpBatchLink({ url: '/admin/trpc' })] });
          export const useOrders = () => trpc.orders.list.useQuery({});
        `,
      },
      { '@trpc/react-query': '^11.0.0', ...TRPC },
      { type: 'ui_api_call' },
    );
    expect(requestFor(two, 'orders.list')?.meta?.['link']).toEqual({ protocol: 'trpc', dynamic: true });
    expect(two.unresolved.map((row) => row.message)).toEqual([
      'orders.list is sent through a link whose address cannot be read: the repository builds links to more than one address, and which one this proxy is given is decided where it is provided, so the service it reaches is the one apiTarget names.',
    ]);
  });
});
