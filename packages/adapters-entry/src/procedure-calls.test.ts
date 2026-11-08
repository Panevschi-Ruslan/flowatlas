import { GraphBuilder, TypeCollector, type GraphNode, type RepoGraph } from '@flowatlas/core';
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
  // A setting that is the whole address, as both halves read one (P91).
  const whole = /^process\.env\.(\w+)$/.exec(url.getText());
  if (whole !== null) return { path: '', baseUrlEnv: whole[1] ?? null, host: null };
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
  options: Partial<Pick<ProcedureCallReading, 'type' | 'readAlready'>> & { typed?: boolean } = {},
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
      ...(options.typed === true ? { types: new TypeCollector({ builder, repo: 'worker' }) } : {}),
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

describe('what a call hands a procedure and reads back (P247)', () => {
  it("types a literal input by the client's declared type, its keys beside it, and the answer it returns", () => {
    const graph = read(
      {
        '/src/orders.ts': `
          import { createORPCClient } from '@orpc/client';
          import { RPCLink } from '@orpc/client/fetch';
          interface NewOrder { sku: string; qty: number }
          interface Placed { id: string }
          interface OrdersApi { orders: { place(input: NewOrder): Promise<Placed> } }
          const orders: OrdersApi = createORPCClient(new RPCLink({ url: 'http://orders.internal/rpc' }));
          export const place = (sku: string) => orders.orders.place({ sku, qty: 1 });
        `,
      },
      ORPC,
      { typed: true },
    );
    const request = requestFor(graph, 'orders.place');
    expect(request?.meta?.['inputType']).toBe('type:worker#NewOrder');
    expect(request?.meta?.['inputKeys']).toEqual(['qty', 'sku']);
    expect(request?.meta?.['outputType']).toBe('type:worker#Placed');
  });

  it('types the input as written where the client is not typed, and its answer as nothing', () => {
    const graph = read(
      {
        '/src/billing.ts': `
          import { createTRPCClient, httpBatchLink } from '@trpc/client';
          const billing = createTRPCClient<any>({ links: [httpBatchLink({ url: 'http://billing.internal/trpc' })] });
          export const invoice = (orderId: string) => billing.invoices.create.mutate({ orderId });
        `,
      },
      TRPC,
      { typed: true },
    );
    const request = requestFor(graph, 'invoices.create');
    expect(request?.meta?.['inputType']).toBe('{orderId:string}');
    // No client installed here: what the call answers names no shape.
    expect(['any', 'unknown']).toContain(request?.meta?.['outputType']);
  });

  it('records no answer for a hook, an input written in place field by field, and one handed later or not written', () => {
    const graph = read(
      {
        '/src/trpc.ts': `
          import { createTRPCReact } from '@trpc/react-query';
          export const trpc = createTRPCReact<any>();
          export const useOrders = () => trpc.orders.list.useQuery({ status: 'open' });
          export const usePlace = () => trpc.orders.place.useMutation();
          export const useAll = () => trpc.orders.all.useQuery();
        `,
      },
      { '@trpc/react-query': '^11.0.0' },
      { type: 'ui_api_call', typed: true },
    );
    const list = requestFor(graph, 'orders.list');
    // The value written, not the `string` the language widens it to.
    expect(list?.meta?.['inputType']).toBe("{status:'open'}");
    expect(list?.meta?.['outputType']).toBeUndefined();
    expect(requestFor(graph, 'orders.place')?.meta?.['inputLater']).toBe(true);
    expect(requestFor(graph, 'orders.all')?.meta?.['inputNone']).toBe(true);
  });

  it("reads an oRPC mutation's options as options, its input handed later", () => {
    const graph = read(
      {
        '/src/orpc.ts': `
          import { createORPCClient } from '@orpc/client';
          import { createTanstackQueryUtils } from '@orpc/tanstack-query';
          import { RPCLink } from '@orpc/client/fetch';
          const orpc = createTanstackQueryUtils(createORPCClient<any>(new RPCLink({ url: '/rpc' })));
          export const options = () => orpc.orders.place.mutationOptions({ onSuccess: () => undefined });
        `,
      },
      { ...ORPC, '@orpc/tanstack-query': '^1.0.0' },
      { type: 'ui_api_call', typed: true },
    );
    const request = requestFor(graph, 'orders.place');
    expect(request?.meta?.['inputLater']).toBe(true);
    expect(request?.meta?.['inputKeys']).toBeUndefined();
    expect(request?.meta?.['inputType']).toBeUndefined();
  });
});

describe('a client injected by a token (P247)', () => {
  const module = (providers: string): Record<string, string> => ({
    '/src/billing.module.ts': `
      import { Module } from '@nestjs/common';
      import { createTRPCClient, httpBatchLink } from '@trpc/client';
      import { client } from './client';
      export const BILLING = 'BILLING';
      export const OTHER = 'OTHER';
      const build = () => createTRPCClient<any>({ links: [httpBatchLink({ url: \`\${process.env.BILLING_URL}/trpc\` })] });
      @Module({ providers: [${providers}] })
      export class BillingModule {}
    `,
    '/src/client.ts': `
      import { createTRPCClient, httpBatchLink } from '@trpc/client';
      export const client = createTRPCClient<any>({ links: [httpBatchLink({ url: 'http://billing.internal/trpc' })] });
    `,
    '/src/billing.service.ts': `
      import { Inject, Injectable } from '@nestjs/common';
      import { BILLING } from './billing.module';
      @Injectable()
      export class BillingService {
        constructor(@Inject(BILLING) private readonly billing: any) {}
        invoice(orderId: string) {
          return this.billing.invoices.create.mutate({ orderId });
        }
      }
    `,
  });
  const linkOf = (providers: string) => requestFor(read(module(providers), TRPC), 'invoices.create')?.meta?.['link'];
  const BILLING_LINK = { protocol: 'trpc', path: '/trpc', baseUrlEnv: 'BILLING_URL' };

  it('follows @Inject(TOKEN) to the client a useFactory returns, written in place, named or as a method', () => {
    expect(linkOf('{ provide: BILLING, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: `${process.env.BILLING_URL}/trpc` })] }) }')).toEqual(BILLING_LINK);
    expect(linkOf('{ provide: BILLING, useFactory: build }')).toEqual(BILLING_LINK);
    expect(linkOf('{ provide: BILLING, useFactory() { return build(); } }')).toEqual(BILLING_LINK);
    expect(linkOf('{ provide: BILLING, useFactory: () => { const made = client; return made; } }')).toEqual({ protocol: 'trpc', path: '/trpc', host: 'billing.internal' });
  });

  it('follows a token provided with a value', () => {
    expect(linkOf('{ provide: BILLING, useValue: client }')).toEqual({ protocol: 'trpc', path: '/trpc', host: 'billing.internal' });
  });

  it('follows nothing, and reads no request, where two providers give the token or none does', () => {
    expect(requestFor(read(module('{ provide: BILLING, useFactory: build }, { provide: BILLING, useValue: client }'), TRPC), 'invoices.create')).toBeUndefined();
    expect(requestFor(read(module('{ provide: OTHER, useFactory: build }'), TRPC), 'invoices.create')).toBeUndefined();
  });

  it('follows an Angular field initialised with inject(TOKEN)', () => {
    const graph = read(
      {
        '/src/app/trpc.ts': `
          import { InjectionToken } from '@angular/core';
          import { createTRPCClient, httpBatchLink } from '@trpc/client';
          export const TRPC = new InjectionToken<any>('trpc');
          export const appConfig = { providers: [{ provide: TRPC, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: '/trpc' })] }) }] };
        `,
        '/src/app/invoices.service.ts': `
          import { Injectable, inject } from '@angular/core';
          import { TRPC } from './trpc';
          @Injectable()
          export class InvoicesService {
            private readonly trpc = inject(TRPC);
            invoicesOf(orderId: string) {
              return this.trpc.invoices.byOrder.query({ orderId });
            }
          }
        `,
      },
      TRPC,
      { type: 'ui_api_call' },
    );
    expect(requestFor(graph, 'invoices.byOrder')?.meta?.['link']).toEqual({ protocol: 'trpc', path: '/trpc' });
  });
});

describe('a client a configured module builds, one call away (P256)', () => {
  /** A module of a workspace package, configured by the service that imports it. */
  const PACKAGE = `
    import { Module, type DynamicModule } from '@nestjs/common';
    import { createTRPCClient, httpBatchLink } from '@trpc/client';
    export const BILLING = 'BILLING';
    const OPTIONS = 'BILLING_OPTIONS';
    export interface BillingOptions { url: string }
    @Module({})
    export class BillingClientModule {
      static forRoot(options: BillingOptions): DynamicModule {
        return {
          module: BillingClientModule,
          providers: [{ provide: BILLING, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: options.url })] }) }],
          exports: [BILLING],
        };
      }
      static forRootAsync(options: { useFactory: (...args: any[]) => BillingOptions; inject?: any[] }): DynamicModule {
        return {
          module: BillingClientModule,
          providers: [
            { provide: OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
            { provide: BILLING, useFactory: ({ url }: BillingOptions) => createTRPCClient<any>({ links: [httpBatchLink({ url })] }), inject: [OPTIONS] },
          ],
          exports: [BILLING],
        };
      }
    }
  `;
  const SERVICE = `
    import { Inject, Injectable } from '@nestjs/common';
    import { BILLING } from '../packages/billing-client/src/module';
    @Injectable()
    export class BillingService {
      constructor(@Inject(BILLING) private readonly billing: any) {}
      invoice(orderId: string) {
        return this.billing.invoices.create.mutate({ orderId });
      }
    }
  `;
  const linkOf = (app: string) =>
    requestFor(
      read(
        {
          '/packages/billing-client/src/module.ts': PACKAGE,
          '/src/billing.service.ts': SERVICE,
          '/src/app.module.ts': `
            import { Module } from '@nestjs/common';
            import { BillingClientModule } from '../packages/billing-client/src/module';
            declare const config: { get(key: string): string };
            ${app}
          `,
        },
        TRPC,
      ),
      'invoices.create',
    )?.meta?.['link'];

  it("reads forRoot's link from the options its one call hands it, and leaves out the forRootAsync nobody calls", () => {
    expect(linkOf('@Module({ imports: [BillingClientModule.forRoot({ url: `${process.env.BILLING_URL}/trpc` })] }) export class AppModule {}')).toEqual({
      protocol: 'trpc',
      path: '/trpc',
      baseUrlEnv: 'BILLING_URL',
    });
  });

  it("reads forRootAsync's link from what its factory returns, through the token the client's factory injects", () => {
    expect(
      linkOf('@Module({ imports: [BillingClientModule.forRootAsync({ useFactory: () => ({ url: `${process.env.BILLING_URL}/trpc` }) })] }) export class AppModule {}'),
    ).toEqual({ protocol: 'trpc', path: '/trpc', baseUrlEnv: 'BILLING_URL' });
  });

  it('follows nothing where the method is called twice, with two addresses', () => {
    const twice = linkOf(`
      @Module({ imports: [BillingClientModule.forRoot({ url: 'http://one.internal/trpc' })] }) export class AppModule {}
      @Module({ imports: [BillingClientModule.forRoot({ url: 'http://two.internal/trpc' })] }) export class OtherModule {}
    `);
    expect(twice).not.toEqual(expect.objectContaining({ path: '/trpc' }));
  });
});

describe('a link address built over a parameter, piece by piece (P259)', () => {
  const PACKAGE = `
    import { Module, type DynamicModule } from '@nestjs/common';
    import { createTRPCClient, httpBatchLink } from '@trpc/client';
    export const BILLING = 'BILLING';
    const OPTIONS = 'BILLING_OPTIONS';
    export interface BillingOptions { base: string }
    @Module({})
    export class BillingClientModule {
      static forRoot(options: BillingOptions): DynamicModule {
        return {
          module: BillingClientModule,
          providers: [{ provide: BILLING, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: \`\${options.base}/trpc\` })] }) }],
        };
      }
      static forRootAsync(options: { useFactory: (...args: any[]) => BillingOptions; inject?: any[] }): DynamicModule {
        return {
          module: BillingClientModule,
          providers: [
            { provide: OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
            { provide: BILLING, useFactory: (resolved: BillingOptions) => createTRPCClient<any>({ links: [httpBatchLink({ url: \`\${resolved.base}/v2/trpc?batch=1\` })] }), inject: [OPTIONS] },
          ],
        };
      }
    }
    export const LEDGER = 'LEDGER';
    export const ledgerClient = (base: string) => createTRPCClient<any>({ links: [httpBatchLink({ url: base + '/rpc' })] });
  `;
  const SERVICE = `
    import { Inject, Injectable } from '@nestjs/common';
    import { BILLING, LEDGER } from '../packages/billing-client/src/module';
    @Injectable()
    export class BillingService {
      constructor(@Inject(BILLING) private readonly billing: any, @Inject(LEDGER) private readonly ledger: any) {}
      invoice(orderId: string) {
        this.ledger.entries.record.mutate({ orderId });
        return this.billing.invoices.create.mutate({ orderId });
      }
    }
  `;
  const graphOf = (app: string, ledger = "const LEDGER_URL = 'http://ledger.internal:4000';") =>
    read(
      {
        '/packages/billing-client/src/module.ts': PACKAGE,
        '/src/billing.service.ts': SERVICE,
        '/src/app.module.ts': `
          import { Module } from '@nestjs/common';
          import { BillingClientModule, LEDGER, ledgerClient } from '../packages/billing-client/src/module';
          ${ledger}
          @Module({ providers: [{ provide: LEDGER, useFactory: () => ledgerClient(LEDGER_URL) }] }) export class LedgerModule {}
          ${app}
        `,
      },
      TRPC,
    );
  const linkOf = (graph: RepoGraph, procedure: string) => requestFor(graph, procedure)?.meta?.['link'];

  it("reads a template over forRoot's option as the setting the one call hands it, and the text after it", () => {
    const graph = graphOf('@Module({ imports: [BillingClientModule.forRoot({ base: process.env.BILLING_URL })] }) export class AppModule {}');
    expect(linkOf(graph, 'invoices.create')).toEqual({ protocol: 'trpc', path: '/trpc', baseUrlEnv: 'BILLING_URL' });
  });

  it("reads one over forRootAsync's factory, through the token it injects, without the query", () => {
    const graph = graphOf("@Module({ imports: [BillingClientModule.forRootAsync({ useFactory: () => ({ base: `${process.env.BILLING_URL}/api` }) })] }) export class AppModule {}");
    expect(linkOf(graph, 'invoices.create')).toEqual({ protocol: 'trpc', path: '/api/v2/trpc', baseUrlEnv: 'BILLING_URL' });
  });

  it('reads an address joined with + over a function parameter as the URL its one call is handed', () => {
    const graph = graphOf('@Module({}) export class AppModule {}');
    expect(linkOf(graph, 'entries.record')).toEqual({ protocol: 'trpc', path: '/rpc', host: 'ledger.internal:4000' });
  });

  it('reads nothing where a piece after the first is not text the files hold', () => {
    const graph = graphOf('@Module({ imports: [BillingClientModule.forRoot({ base: process.env.BILLING_URL })] }) export class AppModule {}', 'declare const LEDGER_URL: string;');
    expect(linkOf(graph, 'entries.record')).toEqual(expect.objectContaining({ dynamic: true }));
  });
});
