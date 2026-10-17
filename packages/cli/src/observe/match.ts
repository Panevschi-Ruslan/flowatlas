import {
  addSpan,
  AMBIGUOUS_CANDIDATES,
  emptyAgg,
  hourOf,
  isError,
  isJoinEdge,
  joinIdOf,
  STEP_OF_META,
  wasRead,
  observedFromParts,
  SAMPLES_PER_ENTRY,
  SPANS_PER_SAMPLE,
  type Agg,
  type AmbiguousKind,
  type AmbiguousSpan,
  type EntrySamples,
  type GraphEdge,
  type GraphNode,
  type JoinAgg,
  type MeasuredAt,
  type Observed,
  type ObservedBucket,
  type ObservedSample,
  type ObservedSource,
  type TraceTree,
  type UnmatchedAgg,
  type UnmatchedKind,
} from '@flowatlas/core';
import { channelLabelOf } from './aws.js';
import { matchAws } from './match-aws.js';
import { VALUE, type ObservedSpan } from './span.js';

export { OBSERVED_FORMAT_VERSION, type Observed } from '@flowatlas/core';

/**
 * Spans laid over the graph: which joins, entries, symbols and channels real
 * traffic went through, and what ran that the code does not show.
 *
 * Pure: the graph and the spans in, the answer out. Nothing is read or written
 * here, so the same trace over the same graph gives the same file. The file's
 * shape is core's (`observed.ts`): one bucket per hour of span start time, the
 * figures of each place as an `Agg` (P105), and a few sample trees per entry.
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

/**
 * One way a message reaches a function (P107): the channel, the `consumes`
 * join onto the subscriber a deployment declares, and the join from that
 * subscriber into the entry it runs - the `invoke` entry, or an `event` entry
 * that names its function.
 */
export interface Delivery {
  channel: GraphNode;
  consumes: GraphEdge;
  wayIn: GraphEdge;
  entry: GraphNode;
  /** The deployed name of the function the entry runs, when the map says it. */
  fn?: string;
}

export interface GraphIndex {
  services: ReadonlySet<string>;
  httpEntries: Routed[];
  httpOuts: Routed[];
  eventEntries: Map<string, GraphNode[]>;
  channels: Map<string, GraphNode>;
  methods: Map<string, GraphNode[]>;
  tables: Map<string, GraphNode[]>;
  /** `invoke` entries by the deployed name of their function; one whose name was not read is left out. */
  invokes: Map<string, GraphNode[]>;
  /** `workflow` entries by the deployed name of their workflow, the same way. */
  workflows: Map<string, GraphNode[]>;
  /** Steps (`function` nodes of kind `state`) by `<workflow>/<step>`. */
  states: Map<string, GraphNode[]>;
  /** Every way a message reaches a function, by channel id and by the function's deployed name. */
  deliveries: { byChannel: Map<string, Delivery[]>; byFunction: Map<string, Delivery[]> };
  from: Map<string, GraphEdge[]>;
  to: Map<string, GraphEdge[]>;
  nodes: Map<string, GraphNode>;
}

/** The deployed name an `invoke` or `workflow` entry is keyed by, when it was read. */
const deployedKey = (node: GraphNode): string | undefined => {
  const key = metaText(node, 'key') ?? node.id.slice(node.id.indexOf(`:${node.kind}:`) + node.kind!.length + 2);
  return key === '' || !wasRead(key) ? undefined : key;
};

/** A step's name, its label before the bracket that says what kind of step it is. */
const stateName = (node: GraphNode): string => node.label.split(' [')[0]!;

export const indexGraph = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphIndex => {
  const index: GraphIndex = {
    services: new Set(nodes.map((node) => node.repo)),
    httpEntries: [],
    httpOuts: [],
    eventEntries: new Map(),
    channels: new Map(),
    methods: new Map(),
    tables: new Map(),
    invokes: new Map(),
    workflows: new Map(),
    states: new Map(),
    deliveries: { byChannel: new Map(), byFunction: new Map() },
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
      } else if (node.kind === 'invoke' || node.kind === 'workflow') {
        const key = deployedKey(node);
        if (key !== undefined) push(node.kind === 'invoke' ? index.invokes : index.workflows, key, node);
      } else if (pattern !== undefined) push(index.eventEntries, pattern, node);
    },
    function: (node) => {
      const workflow = node.kind === 'state' ? metaText(node, STEP_OF_META) : undefined;
      if (workflow !== undefined) push(index.states, `${workflow}/${stateName(node)}`, node);
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
  for (const consumes of edges) {
    const channel = consumes.type === 'consumes' ? index.nodes.get(consumes.from) : undefined;
    if (channel?.type !== 'channel') continue;
    for (const wayIn of index.from.get(consumes.to) ?? []) {
      const entry = isJoinEdge(wayIn) ? index.nodes.get(wayIn.to) : undefined;
      if (entry?.type !== 'entry') continue;
      const fn = entry.kind === 'invoke' ? deployedKey(entry) : metaText(entry, 'function');
      const delivery: Delivery = { channel, consumes, wayIn, entry, ...(fn === undefined ? {} : { fn }) };
      push(index.deliveries.byChannel, channel.id, delivery);
      if (fn !== undefined) push(index.deliveries.byFunction, fn, delivery);
    }
  }
  return index;
};

// --- matching ----------------------------------------------------------------

export const inService = (index: GraphIndex, service: string | undefined) => (node: GraphNode): boolean =>
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

interface HourTally {
  spans: number;
  joins: Map<string, JoinAgg>;
  entries: Map<string, Agg>;
  symbols: Map<string, Agg>;
  channels: Map<string, Agg>;
  unmatched: Map<string, UnmatchedAgg>;
  ambiguous: Map<string, AmbiguousSpan>;
}

const emptyHour = (): HourTally => ({
  spans: 0,
  joins: new Map(),
  entries: new Map(),
  symbols: new Map(),
  channels: new Map(),
  unmatched: new Map(),
  ambiguous: new Map(),
});

/**
 * Accumulates figures by hour; one span counts once, on the one thing it
 * names, and its duration, status and error flag go into that thing's `Agg`.
 * `placeOf` remembers the node each span was credited to, for the samples.
 */
export class Tally {
  readonly hours = new Map<string, HourTally>();
  readonly placeOf = new Map<ObservedSpan, string>();
  /** The entries a span was credited to: a function behind a route is both the route and the function (P107). */
  readonly entryOf = new Map<ObservedSpan, string[]>();

  constructor(private readonly hourFor: (span: ObservedSpan) => string) {}

  private hour(span: ObservedSpan): HourTally {
    const hour = this.hourFor(span);
    let at = this.hours.get(hour);
    if (at === undefined) {
      at = emptyHour();
      this.hours.set(hour, at);
    }
    return at;
  }

  private add(map: Map<string, Agg>, id: string, span: ObservedSpan): Agg {
    let agg = map.get(id);
    if (agg === undefined) {
      agg = emptyAgg();
      map.set(id, agg);
    }
    return addSpan(agg, span);
  }

  span(span: ObservedSpan): void {
    this.hour(span).spans += 1;
  }

  /**
   * A join, measured on `measured`: the caller's span when one was seen, the
   * callee's otherwise (P105 D5), which `side` says.
   */
  join(edge: GraphEdge, measured: ObservedSpan, side: MeasuredAt): void {
    const agg: JoinAgg = this.add(this.hour(measured).joins, edgeIdOf(edge), measured);
    if (side === 'callee') agg.callee = (agg.callee ?? 0) + 1;
  }

  entry(id: string, span: ObservedSpan): void {
    this.add(this.hour(span).entries, id, span);
    const had = this.entryOf.get(span);
    // A sample's node says the first entry the span was credited to: the route, before its function.
    if (had === undefined) this.placeOf.set(span, id);
    this.entryOf.set(span, [...(had ?? []), id]);
  }

  hit(kind: 'symbols' | 'channels', id: string, span: ObservedSpan): void {
    this.add(this.hour(span)[kind], id, span);
    if (!this.placeOf.has(span)) this.placeOf.set(span, id);
  }

  miss(span: ObservedSpan, kind: UnmatchedKind, name: string): void {
    const rows = this.hour(span).unmatched;
    const key = `${span.service ?? ''}\u0000${kind}\u0000${name}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = { ...serviceOf(span), kind, name, ...emptyAgg() };
      rows.set(key, row);
    }
    addSpan(row, span);
  }

  /** A span that fits every one of `candidates` equally, credited to none of them. */
  unsure(span: ObservedSpan, kind: AmbiguousKind, name: string, candidates: readonly string[]): void {
    const rows = this.hour(span).ambiguous;
    const all = [...new Set(candidates)].sort();
    const key = `${span.service ?? ''}\u0000${kind}\u0000${name}\u0000${all.join('\u0000')}`;
    const seen = rows.get(key);
    if (seen !== undefined) {
      seen.count += 1;
      return;
    }
    const more = all.length - AMBIGUOUS_CANDIDATES;
    rows.set(key, {
      ...serviceOf(span),
      kind,
      name,
      candidates: all.slice(0, AMBIGUOUS_CANDIDATES),
      ...(more > 0 ? { more } : {}),
      count: 1,
    });
  }

  buckets(): ObservedBucket[] {
    return [...this.hours.entries()].map(([hour, tally]) => ({
      hour,
      spans: tally.spans,
      joins: sorted(tally.joins),
      entries: sorted(tally.entries),
      symbols: sorted(tally.symbols),
      channels: sorted(tally.channels),
      unmatched: [...tally.unmatched.values()].sort(byCount),
      ambiguous: [...tally.ambiguous.values()].sort(byCount),
    }));
  }
}

const serviceOf = (span: ObservedSpan): { service?: string } =>
  span.service === undefined ? {} : { service: span.service };

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
  for (const edge of edges) if (isJoinEdge(edge)) once.set(edgeIdOf(edge), edge);
  return [...once.values()];
};

/** What a client span was found to be: the call site the far side confirmed, or none it could single out. */
type Confirmed = string | null;

export interface MatchOptions {
  /** The files the spans were read from (P105 D4), written to `sources`. */
  sources?: readonly ObservedSource[];
  /** Attribute keys the readers saw and did not read. */
  droppedAttributes?: number;
  /** The hour a span goes to when neither it nor its trace says when it started. */
  now?: Date;
}

export const matchSpans = (index: GraphIndex, spans: readonly ObservedSpan[], options: MatchOptions = {}): Observed => {
  const hourFor = hourOfSpan(spans, options.now ?? new Date());
  const tally = new Tally(hourFor);
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
  const countJoin = (span: ObservedSpan, edges: readonly GraphEdge[], name: string, side: MeasuredAt): GraphEdge | undefined => {
    const joins = joinsAmong(edges);
    if (joins.length === 1) {
      tally.join(joins[0]!, span, side);
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
        // The caller's own span times the join when there is one (P105 D5).
        if (parent.kind === 'client') tally.join(credited, parent, 'caller');
        else tally.join(credited, span, 'callee');
      } else if (fromCaller.length > 1 || narrowed.length > 1) {
        tally.unsure(span, 'join', nameOf(span), (narrowed.length > 1 ? narrowed : fromCaller).map(edgeIdOf));
      }
      if (parent.kind === 'client') confirmedClients.set(parent, credited?.from ?? null);
    }
    if (entries.length === 1) tally.entry(entries[0]!.id, span);
    else if (credited !== undefined) tally.entry(credited.to, span);
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
    tally.hit('channels', channel.id, span);
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
      edgeType === 'emits' ? 'caller' : 'callee',
    );
    if (edgeType === 'consumes') {
      countOne(span, 'entry', destination, (index.eventEntries.get(destination) ?? []).filter(keep), (entry) =>
        tally.entry(entry.id, span),
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
    countOne(span, 'symbol', name, found, (node) => tally.hit('symbols', node.id, span));
  };

  const table = (span: ObservedSpan): void => {
    const name = span.collection as string;
    const found = (index.tables.get(name.toLowerCase()) ?? []).filter(inService(index, span.service));
    if (found.length === 0) tally.miss(span, 'db', name);
    else countOne(span, 'table', name, found, (node) => tally.hit('symbols', node.id, span));
  };

  const rpc = (span: ObservedSpan): void => {
    const name = span.rpc as string;
    const method = name.split('/').pop() ?? name;
    const found = [...index.eventEntries.entries()]
      .filter(([pattern]) => pattern === name || pattern === method)
      .flatMap(([, nodes]) => nodes.filter(inService(index, span.service)));
    if (found.length === 0) tally.miss(span, 'rpc', name);
    else countOne(span, 'entry', name, found, (node) => tally.entry(node.id, span));
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
      tally.hit('symbols', confirmed, span);
      return;
    }
    if (outs.length === 0) {
      tally.miss(span, 'client', nameOf(span));
      return;
    }
    countOne(span, 'client', nameOf(span), outs, (node) => {
      tally.hit('symbols', node.id, span);
      if (confirmed === undefined) countJoin(span, index.from.get(node.id) ?? [], nameOf(span), 'caller');
    });
  };

  const childrenOf = new Map<ObservedSpan, ObservedSpan[]>();
  for (const span of spans) {
    const parent = parentOf(span);
    if (parent !== undefined) push(childrenOf, parent, span);
  }
  const aws = matchAws(index, tally, { parentOf, childrenOf: (span) => childrenOf.get(span) ?? [] }, { countOne, countJoin });

  for (const span of spans) tally.span(span);
  // Server spans first, so a client span knows whether its far side was seen.
  for (const span of spans) if (span.kind === 'server') server(span);
  for (const span of spans) {
    // A deployed function, a workflow or a cloud SDK call is read in `match-aws.ts` (P107).
    if (aws.claims(span)) aws.match(span);
    else if (span.destination !== undefined && span.kind === 'producer') messaging(span, 'emits');
    else if (span.destination !== undefined && span.kind === 'consumer') messaging(span, 'consumes');
    else if (span.rpc !== undefined && span.kind === 'server') rpc(span);
    if (span.symbol !== undefined) symbol(span);
    if (span.collection !== undefined && span.tables === undefined) table(span);
    // An SDK call is sent as HTTP to the service's endpoint: that request is the call, not one of the code's.
    if (span.kind === 'client' && span.awsOp === undefined && span.method !== undefined && routeOf(span) !== undefined) client(span);
  }

  return observedFromParts({
    buckets: tally.buckets(),
    samples: samplesOf(spans, tally, hourFor),
    sources: options.sources ?? [],
    droppedAttributes: options.droppedAttributes ?? 0,
    samplesKept: true,
  });
};

// --- time and samples ----------------------------------------------------------

/**
 * The hour a span counts in: its own start, else the earliest start in its
 * trace (a child span often says none), else the latest start in the run,
 * else the hour of `now`.
 */
const hourOfSpan = (spans: readonly ObservedSpan[], now: Date): ((span: ObservedSpan) => string) => {
  const traceStart = new Map<string, string>();
  let latest: string | undefined;
  for (const span of spans) {
    if (span.at === undefined) continue;
    const had = traceStart.get(span.traceId);
    if (had === undefined || span.at < had) traceStart.set(span.traceId, span.at);
    if (latest === undefined || span.at > latest) latest = span.at;
  }
  const fallback = hourOf(latest ?? now);
  return (span) => {
    const at = span.at ?? traceStart.get(span.traceId);
    return at === undefined ? fallback : hourOf(at);
  };
};

/**
 * What a span said, from kept fields only: never its name. A workflow step
 * is named only when it was credited to a step the map has (P107 D3).
 */
const labelOf = (span: ObservedSpan, placed: boolean): string => {
  if (span.method !== undefined && (span.route ?? span.path) !== undefined) return nameOf(span);
  if (span.state !== undefined && span.workflow !== undefined) return `${span.workflow}/${placed ? span.state : '?'}`;
  if (span.awsOp !== undefined && span.rpc !== undefined) return span.rpc;
  if (span.kind === 'server' && (span.faas ?? span.workflow) !== undefined) return (span.faas ?? span.workflow)!;
  return channelLabelOf(span) ?? span.symbol ?? span.rpc ?? span.collection ?? span.method ?? span.kind;
};

const nodeOf = (span: ObservedSpan, id: string | undefined): TraceTree => ({
  ...(id === undefined ? {} : { id }),
  label: labelOf(span, id !== undefined),
  ...serviceOf(span),
  kind: span.kind,
  ...(span.durationMs === undefined ? {} : { ms: span.durationMs }),
  ...(span.status === undefined ? {} : { status: span.status }),
  ...(span.error === undefined ? {} : { error: span.error }),
});

/**
 * One request as a tree from the entry's span down, breadth first, at most
 * `SPANS_PER_SAMPLE` spans: each says the node it was credited to, what it
 * said, how long it took and how it answered. No span or parent id is kept;
 * the tree's shape is the parentage.
 */
const sampleOf = (
  root: ObservedSpan,
  childrenOf: ReadonlyMap<string, ObservedSpan[]>,
  placeOf: ReadonlyMap<ObservedSpan, string>,
  at: string,
): ObservedSample => {
  const key = (span: ObservedSpan): string => `${span.traceId}/${span.spanId}`;
  const tree = nodeOf(root, placeOf.get(root));
  const queue: Array<[ObservedSpan, TraceTree]> = [[root, tree]];
  const seen = new Set([key(root)]);
  let spans = 1;
  let cut = 0;
  while (queue.length > 0) {
    const [span, node] = queue.shift()!;
    for (const child of childrenOf.get(key(span)) ?? []) {
      if (seen.has(key(child))) continue;
      seen.add(key(child));
      if (spans >= SPANS_PER_SAMPLE) {
        cut += 1;
        continue;
      }
      spans += 1;
      const branch = nodeOf(child, placeOf.get(child));
      (node.children ??= []).push(branch);
      queue.push([child, branch]);
    }
  }
  return {
    traceId: root.traceId,
    at,
    ...(root.durationMs === undefined ? {} : { ms: root.durationMs }),
    ...(root.status === undefined ? {} : { status: root.status }),
    ...(isError(root) ? { error: true as const } : {}),
    spans,
    ...(cut > 0 ? { cut } : {}),
    tree,
  };
};

/** The first `SAMPLES_PER_ENTRY` by `order`, one per trace. */
const fewest = (spans: ObservedSpan[], order: (a: ObservedSpan, b: ObservedSpan) => number): ObservedSpan[] => {
  const traces = new Set<string>();
  const kept: ObservedSpan[] = [];
  for (const span of spans.sort(order)) {
    if (kept.length === SAMPLES_PER_ENTRY) break;
    if (traces.has(span.traceId)) continue;
    traces.add(span.traceId);
    kept.push(span);
  }
  return kept;
};

/**
 * The slowest and the latest failing requests of each entry a server or
 * consumer span was credited to, at most `SAMPLES_PER_ENTRY` of each.
 */
const samplesOf = (
  spans: readonly ObservedSpan[],
  tally: Tally,
  hourFor: (span: ObservedSpan) => string,
): Record<string, EntrySamples> => {
  const childrenOf = new Map<string, ObservedSpan[]>();
  for (const span of spans) {
    if (span.parentId !== undefined) push(childrenOf, `${span.traceId}/${span.parentId}`, span);
  }
  const byEntry = new Map<string, ObservedSpan[]>();
  for (const [span, entries] of tally.entryOf) {
    // A line of an access log or a REPORT line is one span with an id made up for it: no request to show (P108).
    if (span.sampleable === false) continue;
    for (const entry of entries) push(byEntry, entry, span);
  }
  const samples: Record<string, EntrySamples> = {};
  const atOf = (span: ObservedSpan): string => span.at ?? hourFor(span);
  for (const [entry, roots] of [...byEntry.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const sample = (span: ObservedSpan): ObservedSample => sampleOf(span, childrenOf, tally.placeOf, atOf(span));
    const latest = (a: ObservedSpan, b: ObservedSpan): number =>
      atOf(a) < atOf(b) ? 1 : atOf(a) > atOf(b) ? -1 : a.traceId.localeCompare(b.traceId);
    const slow = fewest(
      roots.filter((span) => span.durationMs !== undefined),
      (a, b) => b.durationMs! - a.durationMs! || latest(a, b),
    ).map(sample);
    const failing = fewest(roots.filter(isError), latest).map(sample);
    if (slow.length + failing.length > 0) samples[entry] = { slow, failing };
  }
  return samples;
};
