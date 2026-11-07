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
import { extractAngular } from './extract-repo.js';

const CORE = `
export interface InjectableMetadata { providedIn?: string }
export declare function Injectable(metadata?: InjectableMetadata): ClassDecorator;
export declare class InjectionToken<T> { constructor(description: string); protected readonly marker: T; }
export declare function inject<T>(token: InjectionToken<T>): T;
`;

const CLIENT = `
export interface TRPCLink { readonly _link: true }
export declare function httpBatchLink(options: { url: string }): TRPCLink;
export declare function createTRPCClient<T = any>(options: { links: TRPCLink[] }): T;
`;

/** An Angular repository whose services call a tRPC tree through a module's client and an injected one. */
const extract = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
  project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
  project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
  project.createSourceFile('node_modules/@trpc/client/index.d.ts', CLIENT);
  project.createSourceFile('node_modules/@trpc/client/package.json', '{"name":"@trpc/client"}');
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);

  const builder = new GraphBuilder({ repo: 'portal', generatedAt: '2026-01-01T00:00:00.000Z' });
  const base: ExtractContext = {
    repo: 'portal',
    repoDir: '/',
    service: { name: 'portal', repo: '.', type: 'angular' },
    config: parseConfig({}),
    pkg: { dependencies: { '@angular/core': '^19.0.0', '@trpc/client': '^11.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractAngular(base);
  return builder.build();
};

const requests = (graph: RepoGraph): GraphNode[] =>
  graph.nodes
    .filter((node) => node.type === 'ui_api_call' && node.kind === 'rpc')
    .sort((a, b) => String(a.meta?.['procedure']).localeCompare(String(b.meta?.['procedure'])));

describe("an Angular application's requests for procedures (P247)", () => {
  const graph = extract({
    'src/app/trpc.ts': `
      import { InjectionToken } from '@angular/core';
      import { createTRPCClient, httpBatchLink } from '@trpc/client';
      export const billing = createTRPCClient<any>({ links: [httpBatchLink({ url: '/trpc' })] });
      export const TRPC = new InjectionToken<any>('trpc');
      export const appConfig = { providers: [{ provide: TRPC, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: '/trpc' })] }) }] };
    `,
    'src/app/invoices.service.ts': `
      import { Injectable, inject } from '@angular/core';
      import { billing, TRPC } from './trpc';
      @Injectable({ providedIn: 'root' })
      export class InvoicesService {
        private readonly trpc = inject(TRPC);
        invoicesOf(orderId: string) {
          return this.trpc.invoices.byOrder.query({ orderId });
        }
        invoice(orderId: string) {
          return billing.invoices.create.mutate({ orderId });
        }
      }
    `,
  });

  it('reads each call as a request of kind rpc, through the shared reader, with its link and its input', () => {
    expect(
      requests(graph).map((node) => [node.meta?.['procedure'], node.meta?.['call'], node.meta?.['link'], node.meta?.['inputType']]),
    ).toEqual([
      ['invoices.byOrder', 'query', { protocol: 'trpc', path: '/trpc' }, '{orderId:string}'],
      ['invoices.create', 'mutation', { protocol: 'trpc', path: '/trpc' }, '{orderId:string}'],
    ]);
  });

  it('hangs each request off the method that makes it', () => {
    const callers = graph.edges.filter((edge) => edge.type === 'calls' && edge.to.startsWith('ui_api_call:')).map((edge) => edge.from);
    expect(callers.sort()).toEqual([
      expect.stringContaining('InvoicesService.invoice'),
      expect.stringContaining('InvoicesService.invoicesOf'),
    ]);
  });
});
