import {
  AMBIGUOUS_CANDIDATES,
  joinIdOf,
  observedOf,
  type AmbiguousKind,
  type AmbiguousSpan,
  type GraphEdge,
  type GraphNode,
  type Observed,
  type Seen,
  type UnmatchedSpan,
} from '@flowatlas/core';
import { VALUE, type ObservedSpan } from './span.js';

export { OBSERVED_FORMAT_VERSION, type Observed } from '@flowatlas/core';

/**
 * Spans laid over the graph: which joins, entries, symbols and channels real
 * traffic went through, and what ran that the code does not show.
 *
 * Pure: the graph and the spans in, the answer out. Nothing is read or written
 * here, so the same trace over the same graph gives the same file. The file's
 * shape is core's (`observed.ts`).
 *
 * A span is credited to a place only when exactly one place fits it (P85). One
 * that fits several - two routes tied for its path, two calls from the caller
 * into the entry, two methods of one name - is credited to none of them and
 * counted under `ambiguous` with the places it could be: a count on a join
 * says that join ran, and spreading one request over several makes each look
 * busier than it is.
 */
export const edgeIdOf = (edge: Pick<GraphEdge, 'from' | 'to' | 'type'>): string =>
  joinIdOf(edge.from, edge.type, edge.to);

// --- routes ------------------------------------------------------------------

const PARAM = ':param';

/** `/orders/{id}` and `/orders/:id` both read as `/orders/:param`. */
export const templateOf = (route: string): string[] =>
  route
    .split('?')[0]!
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment === VALUE ? VALUE : /^(:|\{).*/.test(segment) || segment.includes('${') ? PARAM : segment));

/**
 * How well a declared template fits what was seen, or -1 when it does not: the
 * number of literal segments matched, so the most specific route wins.
 */
export const routeScore = (declared: readonly string[], seen: readonly string[]): number => {
  if (declared.length !== seen.length) return -1;
  let score = 0;
  for (let i = 0; i < declared.length; i += 1) {
    const want = declared[i]!;
    const got = seen[i]!;
    if (want === PARAM) {
      if (got === '') return -1;
      continue;
    }
    if (got === VALUE || got === PARAM || want !== got) return -1;
    score += 1;
  }
  return score;
};

const best = <T>(rows: ReadonlyArray<{ item: T; score: number }>): T[] => {
  const top = Math.max(-1, ...rows.map((row) => row.score));
  return top < 0 ? [] : rows.filter((row) => row.score === top).map((row) => row.item);
};

// --- the graph, indexed once ----------------------------------------------

interface Routed {
  node: GraphNode;
  method: string;
  template: string[];
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const at = map.get(key);
  if (at === undefined) map.set(key, [value]);
  else at.push(value);
};

const metaText = (node: GraphNode, field: string): string | undefined => {
  const value = node.meta?.[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** A symbol as code names it: `Class.method`, the last part of a node id. */
const symbolKey = (node: GraphNode): string => node.id.slice(node.id.lastIndexOf(':') + 1);

export interface GraphIndex {
  services: ReadonlySet<string>;
  httpEntries: Routed[];
  httpOuts: Routed[];
  eventEntries: Map<string, GraphNode[]>;
  channels: Map<string, GraphNode>;
  methods: Map<string, GraphNode[]>;
  tables: Map<string, GraphNode[]>;
  from: Map<string, GraphEdge[]>;
  to: Map<string, GraphEdge[]>;
  nodes: Map<string, GraphNode>;
}

export const indexGraph = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphIndex => {
  const index: GraphIndex = {
    services: new Set(nodes.map((node) => node.repo)),
    httpEntries: [],
    httpOuts: [],
    eventEntries: new Map(),
    channels: new Map(),
    methods: new Map(),
    tables: new Map(),
    from: new Map(),
    to: new Map(),
    nodes: new Map(nodes.map((node) => [node.id, node])),
  };
  const routed = (node: GraphNode): Routed | undefined => {
    const method = metaText(node, 'method');
    const path = metaText(node, 'path');
    return method === undefined || path === undefined
      ? undefined
      : { node, method: method.toUpperCase(), template: templateOf(path) };
  };
  const byType: Record<string, (node: GraphNode) => void> = {
    entry: (node) => {
      const pattern = metaText(node, 'pattern');
      if (node.kind === 'http') {
        const row = routed(node);
        if (row !== undefined) index.httpEntries.push(row);
      } else if (pattern !== undefined) push(index.eventEntries, pattern, node);
    },
    http_out: (node) => {
      const row = routed(node);
      if (row !== undefined) index.httpOuts.push(row);
    },
    ui_api_call: (node) => {
      const row = routed(node);
      if (row !== undefined) index.httpOuts.push(row);
    },
    channel: (node) => index.channels.set(node.label, node),
    method: (node) => push(index.methods, symbolKey(node), node),
    table: (node) => push(index.tables, node.label.toLowerCase(), node),
  };
  for (const node of nodes) byType[node.type]?.(node);
  for (const edge of edges) {
    push(index.from, edge.from, edge);
    push(index.to, edge.to, edge);
  }
  return index;
};

// --- matching ----------------------------------------------------------------

/** Edge types that join two places, the ones `observed` is counted on. */
const JOINS: ReadonlySet<string> = new Set(['http_calls', 'hits', 'emits', 'consumes', 'triggers']);

const inService = (index: GraphIndex, service: string | undefined) => (node: GraphNode): boolean =>
  service === undefined || !index.services.has(service) || node.repo === service;

const routeOf = (span: ObservedSpan): string[] | undefined => {
  const seen = span.route ?? span.path;
  return seen === undefined ? undefined : templateOf(seen);
};

const matchRoute = (rows: readonly Routed[], span: ObservedSpan, keep: (node: GraphNode) => boolean): GraphNode[] => {
  const seen = routeOf(span);
  if (seen === undefined || span.method === undefined) return [];
  return best(
    rows
      .filter((row) => keep(row.node) && (row.method === span.method || row.method === 'ALL'))
      .map((row) => ({ item: row.node, score: routeScore(row.template, seen) })),
  );
};

/** Accumulates counts; one span counts once, on the one thing it names. */
class Tally {
  readonly joins = new Map<string, Seen>();
  readonly entries = new Map<string, { hits: number; lastSeen: string | null }>();
  readonly symbols = new Map<string, { hits: number }>();
  readonly channels = new Map<string, { hits: number }>();
  readonly unmatched = new Map<string, UnmatchedSpan>();
  readonly ambiguous = new Map<string, AmbiguousSpan>();

  join(edge: GraphEdge, at: string | undefined): void {
    const id = edgeIdOf(edge);
    const seen = this.joins.get(id) ?? { count: 0, lastSeen: null };
    seen.count += 1;
    seen.lastSeen = later(seen.lastSeen, at);
    this.joins.set(id, seen);
  }

  entry(id: string, at: string | undefined): void {
    const seen = this.entries.get(id) ?? { hits: 0, lastSeen: null };
    seen.hits += 1;
    seen.lastSeen = later(seen.lastSeen, at);
    this.entries.set(id, seen);
  }

  hit(map: Map<string, { hits: number }>, id: string): void {
    const seen = map.get(id) ?? { hits: 0 };
    seen.hits += 1;
    map.set(id, seen);
  }

  miss(span: ObservedSpan, kind: UnmatchedSpan['kind'], name: string): void {
    const key = `${span.service ?? ''}\u0000${kind}\u0000${name}`;
    const seen = this.unmatched.get(key);
    if (seen !== undefined) seen.count += 1;
    else this.unmatched.set(key, { ...serviceOf(span), kind, name, count: 1 });
  }

  /** A span that fits every one of `candidates` equally, credited to none of them. */
  unsure(span: ObservedSpan, kind: AmbiguousKind, name: string, candidates: readonly string[]): void {
    const all = [...new Set(candidates)].sort();
    const key = `${span.service ?? ''}\u0000${kind}\u0000${name}\u0000${all.join('\u0000')}`;
    const seen = this.ambiguous.get(key);
    if (seen !== undefined) {
      seen.count += 1;
      return;
    }
    const more = all.length - AMBIGUOUS_CANDIDATES;
    this.ambiguous.set(key, {
      ...serviceOf(span),
      kind,
      name,
      candidates: all.slice(0, AMBIGUOUS_CANDIDATES),
      ...(more > 0 ? { more } : {}),
      count: 1,
    });
  }
}

const serviceOf = (span: ObservedSpan): { service?: string } =>
  span.service === undefined ? {} : { service: span.service };

const later = (a: string | null, b: string | undefined): string | null =>
  b === undefined ? a : a === null || b > a ? b : a;

const nameOf = (span: ObservedSpan): string =>
  `${span.method ?? ''} ${span.route ?? span.path ?? ''}`.trim();

const sorted = <V>(map: ReadonlyMap<string, V>): Record<string, V> =>
  Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const byCount = (
  a: { count: number; service?: string; kind: string; name: string },
  b: { count: number; service?: string; kind: string; name: string },
): number =>
  b.count - a.count ||
  (a.service ?? '').localeCompare(b.service ?? '') ||
  a.kind.localeCompare(b.kind) ||
  a.name.localeCompare(b.name);

/** The join edges among `edges`, each once. */
const joinsAmong = (edges: Iterable<GraphEdge>): GraphEdge[] => {
  const once = new Map<string, GraphEdge>();
  for (const edge of edges) if (JOINS.has(edge.type)) once.set(edgeIdOf(edge), edge);
  return [...once.values()];
};

/** What a client span was found to be: the call site the far side confirmed, or none it could single out. */
type Confirmed = string | null;

export const matchSpans = (index: GraphIndex, spans: readonly ObservedSpan[]): Observed => {
  const tally = new Tally();
  const byId = new Map(spans.map((span) => [`${span.traceId}/${span.spanId}`, span]));
  const parentOf = (span: ObservedSpan): ObservedSpan | undefined =>
    span.parentId === undefined ? undefined : byId.get(`${span.traceId}/${span.parentId}`);
  /** What each client span's call reached, filled while server spans are read. */
  const outsOf = new Map<ObservedSpan, GraphNode[]>();
  const clientOuts = (span: ObservedSpan): GraphNode[] => {
    let outs = outsOf.get(span);
    if (outs === undefined) {
      outs = matchRoute(index.httpOuts, span, inService(index, span.service));
      outsOf.set(span, outs);
    }
    return outs;
  };
  const confirmedClients = new Map<ObservedSpan, Confirmed>();

  /** Credits the one join among `edges`, or tells the tally it could be any; the edge credited, if one. */
  const countJoin = (span: ObservedSpan, edges: readonly GraphEdge[], name: string): GraphEdge | undefined => {
    const joins = joinsAmong(edges);
    if (joins.length === 1) {
      tally.join(joins[0]!, span.at);
      return joins[0];
    }
    if (joins.length > 1) tally.unsure(span, 'join', name, joins.map(edgeIdOf));
    return undefined;
  };

  /** Credits the one node among `nodes` with `credit`, or tells the tally it could be any. */
  const countOne = (
    span: ObservedSpan,
    kind: AmbiguousKind,
    name: string,
    nodes: readonly GraphNode[],
    credit: (node: GraphNode) => void,
  ): void => {
    const ids = [...new Set(nodes.map((node) => node.id))];
    if (ids.length === 1) credit(nodes[0]!);
    else if (ids.length > 1) tally.unsure(span, kind, name, ids);
  };

  /**
   * A server span: its entry, and the join from the caller in another service.
   *
   * The join is the one the caller's own call names (`narrowed`), else the one
   * edge from the caller's service into the entry; two of either credit none.
   * A route tie is settled only by that one join, never by guessing.
   */
  const server = (span: ObservedSpan): void => {
    if (span.method === undefined || routeOf(span) === undefined) return;
    const entries = matchRoute(index.httpEntries, span, inService(index, span.service));
    if (entries.length === 0) {
      tally.miss(span, 'http', nameOf(span));
      return;
    }
    const parent = parentOf(span);
    let credited: GraphEdge | undefined;
    if (parent !== undefined && parent.service !== span.service) {
      const outs = parent.kind === 'client' ? new Set(clientOuts(parent).map((node) => node.id)) : new Set<string>();
      const into = joinsAmong(entries.flatMap((entry) => index.to.get(entry.id) ?? []));
      const fromCaller = into.filter((edge) => {
        const source = index.nodes.get(edge.from);
        return source !== undefined && inService(index, parent.service)(source);
      });
      const narrowed = fromCaller.filter((edge) => outs.has(edge.from));
      const unique = narrowed.length === 1 ? narrowed : narrowed.length === 0 && entries.length === 1 ? fromCaller : [];
      if (unique.length === 1) {
        credited = unique[0]!;
        tally.join(credited, span.at);
      } else if (fromCaller.length > 1 || narrowed.length > 1) {
        tally.unsure(span, 'join', nameOf(span), (narrowed.length > 1 ? narrowed : fromCaller).map(edgeIdOf));
      }
      if (parent.kind === 'client') confirmedClients.set(parent, credited?.from ?? null);
    }
    if (entries.length === 1) tally.entry(entries[0]!.id, span.at);
    else if (credited !== undefined) tally.entry(credited.to, span.at);
    else tally.unsure(span, 'entry', nameOf(span), entries.map((entry) => entry.id));
  };

  const messaging = (span: ObservedSpan, edgeType: 'emits' | 'consumes'): void => {
    const destination = span.destination as string;
    const channel = index.channels.get(destination);
    const keep = inService(index, span.service);
    if (channel === undefined) {
      tally.miss(span, 'messaging', destination);
      return;
    }
    tally.hit(tally.channels, channel.id);
    const touching =
      edgeType === 'emits'
        ? (index.to.get(channel.id) ?? []).filter((edge) => edge.type === 'emits')
        : (index.from.get(channel.id) ?? []).filter((edge) => edge.type === 'consumes');
    countJoin(
      span,
      touching.filter((edge) => {
        const other = index.nodes.get(edgeType === 'emits' ? edge.from : edge.to);
        return other !== undefined && keep(other);
      }),
      destination,
    );
    if (edgeType === 'consumes') {
      countOne(span, 'entry', destination, (index.eventEntries.get(destination) ?? []).filter(keep), (entry) =>
        tally.entry(entry.id, span.at),
      );
    }
  };

  const symbol = (span: ObservedSpan): void => {
    const name = span.symbol as string;
    const found = (index.methods.get(name) ?? []).filter(inService(index, span.service));
    if (found.length === 0) {
      if (name.includes('.')) tally.miss(span, 'code', name);
      return;
    }
    countOne(span, 'symbol', name, found, (node) => tally.hit(tally.symbols, node.id));
  };

  const table = (span: ObservedSpan): void => {
    const name = span.collection as string;
    const found = (index.tables.get(name.toLowerCase()) ?? []).filter(inService(index, span.service));
    if (found.length === 0) tally.miss(span, 'db', name);
    else countOne(span, 'table', name, found, (node) => tally.hit(tally.symbols, node.id));
  };

  const rpc = (span: ObservedSpan): void => {
    const name = span.rpc as string;
    const method = name.split('/').pop() ?? name;
    const found = [...index.eventEntries.entries()]
      .filter(([pattern]) => pattern === name || pattern === method)
      .flatMap(([, nodes]) => nodes.filter(inService(index, span.service)));
    if (found.length === 0) tally.miss(span, 'rpc', name);
    else countOne(span, 'entry', name, found, (node) => tally.entry(node.id, span.at));
  };

  /**
   * A client span: the call it was. When the far side was read, the server
   * span already counted the join and may have singled the call out; when it
   * was not, the call itself says which join ran, if it names one.
   */
  const client = (span: ObservedSpan): void => {
    const outs = clientOuts(span);
    const confirmed = confirmedClients.get(span);
    if (confirmed !== undefined && confirmed !== null) {
      tally.hit(tally.symbols, confirmed);
      return;
    }
    if (outs.length === 0) {
      tally.miss(span, 'client', nameOf(span));
      return;
    }
    countOne(span, 'client', nameOf(span), outs, (node) => {
      tally.hit(tally.symbols, node.id);
      if (confirmed === undefined) countJoin(span, index.from.get(node.id) ?? [], nameOf(span));
    });
  };

  // Server spans first, so a client span knows whether its far side was seen.
  for (const span of spans) if (span.kind === 'server') server(span);
  for (const span of spans) {
    if (span.destination !== undefined && span.kind === 'producer') messaging(span, 'emits');
    else if (span.destination !== undefined && span.kind === 'consumer') messaging(span, 'consumes');
    else if (span.rpc !== undefined && span.kind === 'server') rpc(span);
    if (span.symbol !== undefined) symbol(span);
    if (span.collection !== undefined) table(span);
    if (span.kind === 'client' && span.method !== undefined && routeOf(span) !== undefined) client(span);
  }

  return observedOf({
    spans: spans.length,
    joins: sorted(tally.joins),
    entries: sorted(tally.entries),
    symbols: sorted(tally.symbols),
    channels: sorted(tally.channels),
    unmatched: [...tally.unmatched.values()].sort(byCount),
    ambiguous: [...tally.ambiguous.values()].sort(byCount),
  });
};
