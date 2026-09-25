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
`;

const CLIENT = `
export declare class Socket {
  emit(event: string, ...payload: unknown[]): this;
  on(event: string, listener: (...payload: never[]) => void): this;
  once(event: string, listener: (...payload: never[]) => void): this;
}
export declare function io(uri?: string, options?: unknown): Socket;
`;

const ENVIRONMENT = `export const environment = { apiUrl: 'https://api.test' };
declare const runtime: { readonly namespace: string };
export const chosen = runtime.namespace;`;

/**
 * One service holding one socket, which is how a browser holds one.
 *
 * The client is a package here rather than a class beside the code, because
 * that is the whole of what the pass believes: `emit` on something a package
 * declares is a publish, and `emit` on anything else is a method call.
 */
const extract = (body: string): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
  project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
  project.createSourceFile('node_modules/socket.io-client/index.d.ts', CLIENT);
  project.createSourceFile(
    'node_modules/socket.io-client/package.json',
    '{"name":"socket.io-client"}',
  );
  project.createSourceFile('environment.ts', ENVIRONMENT);
  project.createSourceFile(
    'orders.service.ts',
    `import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment, chosen } from './environment';

@Injectable({ providedIn: 'root' })
export class OrdersSocketService {
${body}
}
`,
  );

  const builder = new GraphBuilder({ repo: 'web', generatedAt: '2026-01-01T00:00:00.000Z' });
  const base: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '.', type: 'angular' },
    config: parseConfig({}),
    pkg: { dependencies: { 'socket.io-client': '^4.8.0' } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractAngular(base);
  return builder.build();
};

const nodesOf = (graph: RepoGraph, type: string): GraphNode[] =>
  graph.nodes.filter((node) => node.type === type);

const labels = (graph: RepoGraph, type: string): string[] =>
  nodesOf(graph, type).map((node) => node.label);

describe("the browser's half of a socket", () => {
  it('names the channel after the namespace the socket was opened on', () => {
    const graph = extract(`
  private readonly socket: Socket = io(\`\${environment.apiUrl}/orders\`);
  cancel(id: string): void {
    this.socket.emit('order:cancel', { id });
  }
`);
    expect(labels(graph, 'channel')).toEqual(['orders/order:cancel']);
    expect(labels(graph, 'producer')).toEqual(['event orders/order:cancel']);
  });

  it('names the bare event when the socket was opened on the root namespace', () => {
    const graph = extract(`
  private readonly socket: Socket = io(environment.apiUrl);
  cancel(id: string): void {
    this.socket.emit('order:cancel', { id });
  }
`);
    expect(labels(graph, 'channel')).toEqual(['order:cancel']);
  });

  it('reads a listener as a consumer of the channel, pointed at what it delegates to', () => {
    const graph = extract(`
  private readonly socket: Socket = io(\`\${environment.apiUrl}/orders\`);
  latest: unknown = null;
  watch(): void {
    this.socket.on('order:updated', (update: unknown) => this.apply(update));
  }
  apply(update: unknown): void {
    this.latest = update;
  }
`);
    expect(labels(graph, 'consumer')).toEqual(['OrdersSocketService.apply']);
    expect(
      graph.edges.some(
        (edge) => edge.type === 'consumes' && edge.from === 'channel:orders/order:updated',
      ),
    ).toBe(true);
  });

  it('reads a publish that hands over a callback as a request rather than a publish', () => {
    const graph = extract(`
  private readonly socket: Socket = io(\`\${environment.apiUrl}/orders\`);
  summary: unknown = null;
  request(id: string): void {
    this.socket.emit('order:summary', id, (summary: unknown) => this.show(summary));
  }
  show(summary: unknown): void {
    this.summary = summary;
  }
`);
    expect(nodesOf(graph, 'producer')[0]?.kind).toBe('rpc');
    // The reply needs no edge of its own: the callback's body belongs to the
    // method that wrote it, so the chain already continues into the handler.
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === 'calls' &&
          edge.from.endsWith('OrdersSocketService.request') &&
          edge.to.endsWith('OrdersSocketService.show'),
      ),
    ).toBe(true);
  });

  it('leaves the library signalling to itself off the graph entirely', () => {
    const graph = extract(`
  private readonly socket: Socket = io(\`\${environment.apiUrl}/orders\`);
  online = false;
  watch(): void {
    this.socket.on('connect', () => this.markOnline());
  }
  markOnline(): void {
    this.online = true;
  }
`);
    expect(nodesOf(graph, 'channel')).toEqual([]);
    expect(nodesOf(graph, 'consumer')).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });

  it('records no channel and says so when the event name cannot be read', () => {
    const graph = extract(`
  private readonly socket: Socket = io(\`\${environment.apiUrl}/orders\`);
  audit(event: string): void {
    this.socket.emit(event, {});
  }
`);
    expect(nodesOf(graph, 'channel')).toEqual([]);
    expect(graph.unresolved.map((row) => row.reason)).toEqual(['channel-const-unresolved']);
  });

  // The event name here is a plain literal; it is the endpoint under it that is
  // missing, and defaulting to the root namespace would join this to a gateway
  // it may have nothing to do with.
  it('records no channel and says so when the namespace is hidden inside the address', () => {
    const graph = extract(`
  private readonly socket: Socket = io(\`\${environment.apiUrl}/\${chosen}\`);
  watch(): void {
    this.socket.on('order:updated', (update: unknown) => this.apply(update));
  }
  apply(update: unknown): void {
    void update;
  }
`);
    expect(nodesOf(graph, 'channel')).toEqual([]);
    expect(graph.unresolved.map((row) => row.reason)).toEqual(['channel-dynamic']);
  });

  it('reads nothing at all from an emit on something no package declared', () => {
    const graph = extract(`
  private readonly bus = { emit(event: string, payload: unknown): void { void event; void payload; } };
  cancel(id: string): void {
    this.bus.emit('order:cancel', { id });
  }
`);
    expect(nodesOf(graph, 'channel')).toEqual([]);
    expect(nodesOf(graph, 'producer')).toEqual([]);
  });
});
