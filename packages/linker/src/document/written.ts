/**
 * What every document written from the graph has in common (P118): which
 * service and application it is of, the operations it holds and where each
 * one came from, and what was left out of it and why (I3).
 *
 * The two writers - OpenAPI for routes, AsyncAPI for channels - read the same
 * graph through the same five questions the contract check asks
 * (`GraphLookup`), so a database, a project graph in memory and a test's
 * handful of nodes all write the same document.
 */
import type { GraphLookup } from '@flowatlas/contracts';
import { accessOf, matchesRoutePattern, type Confidence, type FlowatlasConfig, type GraphEdge, type GraphNode } from '@flowatlas/core';
import type { ShapeOptions } from './write-shapes.js';

/** The two formats written, by the name of the specification. */
export const SPEC_KINDS = ['openapi', 'asyncapi'] as const;
export type SpecKind = (typeof SPEC_KINDS)[number];

/** What a document cannot be read from, beside `version` in `info`: the graph has no version. */
export const SPEC_VERSION_SAID = 'unversioned';

/**
 * Why an end of a service is not in its document, counted per document.
 *
 * `path-unread` a route whose path was not read · `any-verb` a route that
 * answers every verb, which a document cannot say · `duplicate-route` a second
 * route on the same verb and path · `channel-unread` a publish whose channel
 * was not read. A procedure is not a route and is not counted here: the
 * inventory lists it.
 */
export const SPEC_OMITTED_REASONS = ['path-unread', 'any-verb', 'duplicate-route', 'channel-unread'] as const;
export type SpecOmittedReason = (typeof SPEC_OMITTED_REASONS)[number];

/** One end on the other side of an operation, as joined in this project. */
export interface SpecCaller {
  /** The node at that end: the request, the publisher, the consumer. */
  id: string;
  service: string;
  file?: string;
  line?: number;
  confidence: Confidence;
  /** The edge it joins by. */
  via: string;
}

/** One operation of a written document, and what the graph knows about it beyond the file. */
export interface SpecOperation {
  /** `POST /orders/{id}`, `send order.created`, `receive order.created`: unique in its document. */
  key: string;
  kind: 'http' | 'send' | 'receive';
  /** The node it was written from: the entry, the producer, the consumer. */
  node: string;
  /** Keys from the top of the document to the operation. */
  pointer: string[];
  /** `POST:/orders/:param` for a route, as a route's id keys it. */
  route?: string;
  /** The channel's id, for a channel's operation. */
  channel?: string;
  /** Requests that join a route; consumers of what is sent; publishers of what is received. */
  callers: SpecCaller[];
  /** Why the route is open on purpose, when something says it is. */
  public?: string;
  confidence: Confidence;
  file?: string;
  line?: number;
}

/** One document, written in memory: a file's content and everything said about it. */
export interface WrittenSpec {
  kind: SpecKind;
  service: string;
  /** The application inside the service, when it has more than one address space. */
  application?: string;
  /** `orders`, or `orders@admin`: the stem of the file. */
  name: string;
  document: Record<string, unknown>;
  operations: SpecOperation[];
  /** Ends left out of the document, by reason (I3). */
  omitted: Record<string, number>;
  /** Schemas written as `{}` with `x-flowatlas-unread`, by reason. */
  unread: Record<string, number>;
}

export interface SpecOptions extends ShapeOptions {
  /** Routes public by decision, as `doctor.publicRoutes` spells them. */
  publicRoutes?: readonly string[];
  /** Decorators that say a route is public, as `doctor.publicDecorators` names them. */
  publicDecorators?: readonly string[];
}

/**
 * What a project's configuration says the writers should know: which routes
 * are public by decision and which wire rules are off. One reading, so the
 * command line and the MCP server write the same document.
 */
export const specOptionsOf = (
  config: Pick<FlowatlasConfig, 'doctor' | 'contracts'> | undefined,
  extra: ShapeOptions = {},
): SpecOptions => ({
  ...(config === undefined
    ? {}
    : {
        publicRoutes: config.doctor.publicRoutes,
        publicDecorators: config.doctor.publicDecorators,
        disableRules: config.contracts.rules.disable,
      }),
  ...extra,
});

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A map's keys in order, as a record, so a document is the same bytes on every run. */
export const sortedRecord = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(([a], [b]) => cmp(a, b)));

export const count = (into: Record<string, number>, reason: string): void => {
  into[reason] = (into[reason] ?? 0) + 1;
};

/** `orders@admin` → `admin`; nothing for an entry of the service's one application. */
export const applicationOf = (entryId: string): string | undefined => {
  const rest = entryId.startsWith('entry:') ? entryId.slice('entry:'.length) : entryId;
  const service = rest.slice(0, rest.indexOf(':'));
  const at = service.indexOf('@');
  return at < 0 ? undefined : service.slice(at + 1);
};

/** Where a node is, as a document says it: `src/orders/orders.controller.ts:19`. */
export const sourceOf = (place: { file?: string | undefined; line?: number | undefined } | undefined): string | undefined =>
  place?.file === undefined || place.file === '' ? undefined : place.line === undefined ? place.file : `${place.file}:${place.line}`;

/** Callers by service, counted, as `x-flowatlas-callers` writes them. */
export const callersBy = (callers: readonly SpecCaller[]): Record<string, number> => {
  const by: Record<string, number> = {};
  for (const caller of callers) count(by, caller.service);
  return sortedRecord(Object.entries(by));
};

const callerOf = (lookup: GraphLookup, edge: GraphEdge, end: 'from' | 'to'): SpecCaller => {
  const id = edge[end];
  const node = lookup.node(id);
  const file = edge.file ?? node?.file;
  const line = edge.line ?? node?.line;
  return {
    id,
    service: node?.repo ?? 'unknown',
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    confidence: edge.confidence,
    via: edge.type,
  };
};

const byPlace = (a: SpecCaller, b: SpecCaller): number =>
  cmp(a.service, b.service) || cmp(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || cmp(a.id, b.id);

/** The requests joined to a route: browsers' calls and other services'. */
export const routeCallers = (lookup: GraphLookup, entryId: string): SpecCaller[] =>
  lookup
    .edgesTo(entryId, ['http_calls', 'hits'])
    .map((edge) => callerOf(lookup, edge, 'from'))
    .sort(byPlace);

/** The consumers on a channel, the other end of what a service sends there. */
export const channelConsumers = (lookup: GraphLookup, channelId: string): SpecCaller[] =>
  lookup
    .edgesFrom(channelId, ['consumes'])
    .map((edge) => callerOf(lookup, edge, 'to'))
    .sort(byPlace);

/** The publishers on a channel, the other end of what a service receives there. */
export const channelProducers = (lookup: GraphLookup, channelId: string): SpecCaller[] =>
  lookup
    .edgesTo(channelId, ['emits'])
    .map((edge) => callerOf(lookup, edge, 'from'))
    .sort(byPlace);

const decoratorNames = (entry: GraphNode): string[] => {
  const decorators = entry.meta?.['decorators'];
  return Array.isArray(decorators)
    ? decorators
        .map((decorator) => (typeof decorator === 'object' && decorator !== null ? (decorator as { name?: unknown }).name : decorator))
        .filter((name): name is string => typeof name === 'string')
    : [];
};

/**
 * Why a route is open on purpose, when anything says so: the
 * `@flowatlas-public` marker (P90), an opt-out that says public (P76), a
 * decorator `doctor.publicDecorators` names, or `doctor.publicRoutes`.
 * Nothing else is read as public - not the verb, not the path, not a name.
 */
export const publicOf = (entry: GraphNode, options: SpecOptions): string | undefined => {
  const note = entry.meta?.['publicNote'];
  if (typeof note === 'string') return note === '' ? '@flowatlas-public' : `@flowatlas-public ${note}`;
  const optOut = (accessOf(entry)?.optOuts ?? []).find((item) => item.public);
  if (optOut !== undefined) return `@${optOut.decorator.replace(/^@/, '')}`;
  const decorator = decoratorNames(entry).find((name) => (options.publicDecorators ?? []).includes(name));
  if (decorator !== undefined) return `@${decorator}`;
  const method = typeof entry.meta?.['method'] === 'string' ? (entry.meta['method'] as string) : '';
  const path = typeof entry.meta?.['path'] === 'string' ? (entry.meta['path'] as string) : '';
  const pattern = (options.publicRoutes ?? []).find((item) => matchesRoutePattern(item, method, path));
  return pattern === undefined ? undefined : `doctor.publicRoutes ${pattern}`;
};

/** Every node of a type in one service, in id order. */
export const serviceNodes = (lookup: GraphLookup, type: string, service: string): GraphNode[] =>
  lookup
    .nodesByType(type)
    .filter((node) => node.repo === service)
    .sort((a, b) => cmp(a.id, b.id));
