import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type ExtractContext,
  type GraphNode,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractAngular } from './extract-repo.js';

const CORE = `
export interface InjectableMetadata { providedIn?: string }
export declare function Injectable(metadata?: InjectableMetadata): ClassDecorator;
`;

const ENVIRONMENT = `export const environment = { apiUrl: 'https://api.test' };`;

/**
 * Nothing stubs `EventSource` here on purpose.
 *
 * It comes from the language's own library, which the in-memory project already
 * has, and coming from there is the whole of what this pass believes. A stub
 * written beside the code would be rejected exactly as a class of the
 * repository's own is, which is the last two cases below.
 */
const extract = (body: string, service: Partial<ServiceConfig> = {}, extra = ''): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
  project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
  project.createSourceFile('environment.ts', ENVIRONMENT);
  project.createSourceFile(
    'live.service.ts',
    `import { Injectable } from '@angular/core';
import { environment } from './environment';

@Injectable({ providedIn: 'root' })
export class LiveService {
${body}
}
${extra}
`,
  );

  const builder = new GraphBuilder({ repo: 'web', generatedAt: '2026-01-01T00:00:00.000Z' });
  const base: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '.', type: 'angular', ...service },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractAngular(base);
  return builder.build();
};

const streamsOf = (graph: RepoGraph): GraphNode[] =>
  graph.nodes.filter((node) => node.type === 'ui_api_call' && node.kind === 'sse');

const only = (graph: RepoGraph): GraphNode => {
  const [stream] = streamsOf(graph);
  if (stream === undefined) throw new Error('no subscription was recorded');
  return stream;
};

describe('streams the browser subscribes to', () => {
  it('records a subscription as the one request it is', () => {
    const graph = extract(`
  open(depotId: string): void {
    const url = \`\${environment.apiUrl}/depots/\${depotId}/events\`;
    const source = new EventSource(url);
    source.onmessage = () => undefined;
  }
`);
    const stream = only(graph);
    expect(stream.meta?.['method']).toBe('GET');
    expect(stream.meta?.['path']).toBe('/depots/:param/events');
    expect(stream.meta?.['baseUrlEnv']).toBe('apiUrl');
    expect(stream.meta?.['client']).toBe('EventSource');
    expect(stream.meta?.['package']).toBeNull();
  });

  it('hangs the request off the method that opened it, statically', () => {
    const graph = extract(`
  open(): void { new EventSource(\`\${environment.apiUrl}/events\`); }
`);
    const edge = graph.edges.find((candidate) => candidate.to === only(graph).id);
    expect(edge?.type).toBe('calls');
    expect(edge?.confidence).toBe('static');
    expect(edge?.from).toBe('web#live.service.ts:LiveService.open');
  });

  it('reports an address built at run time rather than guessing one', () => {
    const graph = extract(`  open(url: string): void { new EventSource(url); }`);
    const stream = only(graph);
    expect(stream.meta?.['path']).toBeNull();
    expect(graph.unresolved.map((row) => row.reason)).toEqual(['api-path-dynamic']);
    expect(graph.unresolved[0]?.hint).toContain('@flowatlas-calls GET /path');
    expect(graph.edges.find((edge) => edge.to === stream.id)?.confidence).toBe('heuristic');
  });

  it('reads a stream a wrapper opens at each caller that hands it the address', () => {
    const graph = extract(
      `  open(url: string): void { new EventSource(url); }
  private url(orderId: string): string { return \`\${environment.apiUrl}/orders/\${orderId}/stream\`; }
  track(orderId: string, token: string): void {
    this.open(\`\${this.url(orderId)}?token=\${token}\`);
  }`,
      {},
      `
@Injectable({ providedIn: 'root' })
export class KitchenScreen {
  constructor(private readonly live: LiveService) {}
  watch(): void { this.live.open(\`\${environment.apiUrl}/kitchen/events\`); }
}
`,
    );
    const streams = streamsOf(graph);
    expect(streams.map((stream) => stream.meta?.['path']).sort()).toEqual([
      '/kitchen/events',
      '/orders/:param/stream',
    ]);
    expect(streams.every((stream) => stream.meta?.['through'] === 'LiveService.open')).toBe(true);
    const kitchen = streams.find((stream) => stream.meta?.['path'] === '/kitchen/events');
    expect(graph.edges.find((edge) => edge.to === kitchen?.id)?.from).toBe(
      'web#live.service.ts:KitchenScreen.watch',
    );
    expect(graph.unresolved).toEqual([]);
  });

  it('leaves a class of the repository’s own alone, whatever it is called', () => {
    const graph = extract(
      `  open(): LocalSource { return new LocalSource('/events'); }`,
      {},
      `export class LocalSource { constructor(readonly url: string) {} }`,
    ).nodes;
    expect(graph.filter((node) => node.type === 'ui_api_call')).toEqual([]);
  });

  it('is silent about a name it cannot resolve to the browser’s client', () => {
    // Shadowing the global with a declaration in the repository is the case that
    // must produce nothing at all: there is no stream to have missed.
    const graph = extract(
      `  open(): void { new EventSource('/events'); }`,
      {},
      `export class EventSource { constructor(readonly url: string) {} }`,
    );
    expect(streamsOf(graph)).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });
});
