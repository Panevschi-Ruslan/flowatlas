import {
  joinIdOf,
  joinOfId,
  observedOver,
  type GraphEdge,
  type GraphNode,
  type Observed,
  type ObservedRollUp,
  type ReadWindow,
  type Seen,
} from '@flowatlas/core';
import type { GraphDb } from '../db/reader.js';
import { byId, ownerOf } from './graph.js';

/**
 * Traffic laid over the static graph at read time (P110): what the code can
 * reach and traffic never touched in the window, and the best guesses traffic
 * went through.
 *
 * Static reach says "nothing in the code calls this"; it cannot say "nothing
 * calls this from outside". A window of traffic is that evidence, and it is
 * evidence with a confidence, not a verdict (D1): seen in the window is alive,
 * never seen while its neighbours were busy is likely dead, and never seen in
 * a service nobody exercised says nothing. The analysis is handed the
 * observed file as data (D4), so the CLI, the MCP server and the page answer
 * alike, and it never changes the graph (D2, I7).
 */

/** How often a neighbour must have been seen for a silence beside it to mean something. */
export const MIN_NEIGHBOUR_HITS = 20;

/** Edges that say something in the code reaches a node. */
const REACHING: ReadonlySet<string> = new Set(['http_calls', 'hits', 'triggers', 'consumes', 'calls', 'handles']);

/** What a walk from the ways in follows to find the methods they run. */
const RUNS = ['handles', 'calls'] as const;

/** How far that walk goes, over the whole graph. */
const REACH_NODES = 20_000;

export type NeverSeenConfidence = 'strong' | 'weak';

/** One way in, channel or method the code can run and traffic never touched. */
export interface NeverSeenRow {
  id: string;
  type: string;
  kind?: string;
  service: string;
  loc?: string;
  /** The window said in words: `7d`, or what the file holds when that is less. */
  window: string;
  /** Whether anything in the code reaches it, or only something outside could. */
  reachableFrom: 'outside' | 'code';
  /** Its siblings - ways in of the same service and kind, methods of the same class, channels of the same service: how many were seen, of how many, and the busiest one's hits. */
  neighbours: { seen: number; of: number; most: number };
  confidence: NeverSeenConfidence;
}

export interface NeverSeenAnswer {
  rows: NeverSeenRow[];
  /** One per service the window holds no span of: its silence says nothing. */
  notes: string[];
  window: ReadWindow;
}

export interface NeverSeenOptions {
  /** `7d`: the last of what the file holds; absent, all of it. */
  since?: string;
  service?: string;
  /** A node type (`entry`, `channel`, `method`) or an entry kind (`http`, `cron`). */
  kind?: string;
  confidence?: NeverSeenConfidence;
  /** Default `MIN_NEIGHBOUR_HITS`. */
  minNeighbourHits?: number;
}

/** What the overlay reads of the observed file: its hours and its window. */
export type ObservedInput = Pick<Observed, 'buckets' | 'window'>;

const locOf = (node: GraphNode): string | undefined =>
  node.file === undefined ? undefined : node.line === undefined ? node.file : `${node.file}:${node.line}`;

/** How often a node was seen itself: a way in hit, a symbol named, a channel used. */
const hitsOf = (counts: ObservedRollUp, id: string): number =>
  counts.entries[id]?.hits ?? counts.symbols[id]?.hits ?? counts.channels[id]?.hits ?? 0;

/** The services the window holds a span of: whatever was credited, and whatever was named and matched nothing. */
const servicesSeen = (db: GraphDb, counts: ObservedRollUp): { any: Set<string>; symbols: Set<string> } => {
  const any = new Set<string>();
  const symbols = new Set<string>();
  const add = (id: string): GraphNode | undefined => {
    const node = db.node(id);
    if (node !== undefined && node.repo !== '') any.add(node.repo);
    return node;
  };
  for (const id of [...Object.keys(counts.entries), ...Object.keys(counts.channels)]) add(id);
  for (const id of Object.keys(counts.symbols)) {
    const node = add(id);
    if (node?.type === 'method') symbols.add(node.repo);
  }
  for (const id of Object.keys(counts.joins)) {
    const join = joinOfId(id);
    if (join !== undefined) {
      add(join.from);
      add(join.to);
    }
  }
  for (const row of [...counts.unmatched, ...counts.ambiguous]) if (row.service !== undefined) any.add(row.service);
  return { any, symbols };
};

/** Every join into or out of a node that the window holds, so a way in credited only by its join still counts as seen. */
const joinedNodes = (counts: ObservedRollUp): Map<string, { count: number; lastSeen: string | null }> => {
  const found = new Map<string, { count: number; lastSeen: string | null }>();
  for (const [id, seen] of Object.entries(counts.joins)) {
    const join = joinOfId(id);
    if (join === undefined) continue;
    for (const end of [join.from, join.to]) {
      const had = found.get(end) ?? { count: 0, lastSeen: null };
      const lastSeen = had.lastSeen === null || (seen.lastSeen !== null && seen.lastSeen > had.lastSeen) ? seen.lastSeen : had.lastSeen;
      found.set(end, { count: had.count + seen.count, lastSeen });
    }
  }
  return found;
};

/**
 * How often each handler ran, as the ways in it handles were hit: a request
 * to a route ran its handler whether or not a span named the method, so a
 * handler of a busy way in is never "never seen".
 */
const handledNodes = (db: GraphDb, counts: ObservedRollUp): Map<string, { count: number; lastSeen: string | null }> => {
  const found = new Map<string, { count: number; lastSeen: string | null }>();
  for (const [id, seen] of Object.entries(counts.entries)) {
    if (seen.hits === 0) continue;
    for (const edge of db.edgesFrom(id, ['handles'])) {
      const had = found.get(edge.to) ?? { count: 0, lastSeen: null };
      const lastSeen = had.lastSeen === null || (seen.lastSeen != null && seen.lastSeen > had.lastSeen) ? (seen.lastSeen ?? null) : had.lastSeen;
      found.set(edge.to, { count: had.count + seen.hits, lastSeen });
    }
  }
  return found;
};

/** The methods the ways in run, read down their handlers and calls. */
const methodsReached = (db: GraphDb): Set<string> => {
  const seen = new Set<string>();
  const queue = db.nodesByType('entry').map((entry) => entry.id);
  while (queue.length > 0 && seen.size < REACH_NODES) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of db.edgesFrom(id, RUNS)) if (!seen.has(edge.to)) queue.push(edge.to);
  }
  return new Set([...seen].filter((id) => db.node(id)?.type === 'method'));
};

interface Candidate {
  node: GraphNode;
  service: string;
  /** The key its siblings share. */
  family: string;
  reachableFrom: 'outside' | 'code';
}

/** The service a channel is said under: its first publisher's, else its first consumer's. */
const channelService = (db: GraphDb, channel: GraphNode): { service: string; services: string[]; produced: boolean } => {
  const producers = db.edgesTo(channel.id, ['emits']).map((edge) => db.node(edge.from)?.repo).filter((repo): repo is string => repo !== undefined);
  const consumers = db.edgesFrom(channel.id, ['consumes']).map((edge) => db.node(edge.to)?.repo).filter((repo): repo is string => repo !== undefined);
  const services = [...new Set([...producers, ...consumers])].sort(byId);
  return { service: [...producers].sort(byId)[0] ?? [...consumers].sort(byId)[0] ?? channel.repo, services, produced: producers.length > 0 };
};

/** Every node the never-seen question is asked of, with the family its siblings share. */
const candidatesOf = (db: GraphDb): Candidate[] => {
  const found: Candidate[] = [];
  for (const entry of db.nodesByType('entry')) {
    const reached = db.edgesTo(entry.id).some((edge) => REACHING.has(edge.type));
    found.push({ node: entry, service: entry.repo, family: `entry\u0000${entry.repo}\u0000${entry.kind ?? ''}`, reachableFrom: reached ? 'code' : 'outside' });
  }
  for (const channel of db.nodesByType('channel')) {
    const { service, produced } = channelService(db, channel);
    found.push({ node: channel, service, family: `channel\u0000${service}`, reachableFrom: produced ? 'code' : 'outside' });
  }
  for (const id of methodsReached(db)) {
    const method = db.node(id)!;
    found.push({ node: method, service: method.repo, family: `method\u0000${ownerOf(id) ?? id}`, reachableFrom: 'code' });
  }
  return found;
};

const STRENGTH: Readonly<Record<NeverSeenConfidence, number>> = { strong: 0, weak: 1 };

/**
 * What the code can run and traffic never touched in the window (P110).
 *
 * Asked of ways in (all kinds), channels, and methods a way in reaches, in
 * services the window holds a span of; a service with none gives one note and
 * no rows (I3). A method is asked about only where the service's spans name
 * methods at all, since an entry seen without its methods says nothing about
 * them (§10). A row is `strong` when the file holds the whole window asked
 * for and a sibling was seen at least `minNeighbourHits` times; otherwise the
 * service may simply not have been exercised there, and it is `weak`. Strong
 * first, then by the busiest sibling, then by id.
 */
export const neverSeen = (db: GraphDb, observed: ObservedInput, options: NeverSeenOptions = {}): NeverSeenAnswer => {
  const { counts, window } = observedOver(observed, options.since);
  const minHits = options.minNeighbourHits ?? MIN_NEIGHBOUR_HITS;
  const served = servicesSeen(db, counts);
  const joined = joinedNodes(counts);
  const handled = handledNodes(db, counts);
  const seenTimes = (id: string): number => hitsOf(counts, id) || joined.get(id)?.count || handled.get(id)?.count || 0;

  const candidates = candidatesOf(db).filter((candidate) => options.service === undefined || candidate.service === options.service);
  const families = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const family = families.get(candidate.family) ?? [];
    family.push(candidate);
    families.set(candidate.family, family);
  }

  const rows: NeverSeenRow[] = [];
  const silent = new Set<string>();
  for (const candidate of candidates) {
    const { node, service } = candidate;
    if (!served.any.has(service)) {
      if (service !== '') silent.add(service);
      continue;
    }
    if (node.type === 'method' && !served.symbols.has(service)) continue;
    if (seenTimes(node.id) > 0) continue;
    const siblings = (families.get(candidate.family) ?? []).filter((other) => other.node.id !== node.id);
    const hits = siblings.map((other) => seenTimes(other.node.id));
    const most = Math.max(0, ...hits);
    const confidence: NeverSeenConfidence = !window.short && most >= minHits ? 'strong' : 'weak';
    const loc = locOf(node);
    rows.push({
      id: node.id,
      type: node.type,
      ...(node.kind === undefined ? {} : { kind: node.kind }),
      service,
      ...(loc === undefined ? {} : { loc }),
      window: window.label,
      reachableFrom: candidate.reachableFrom,
      neighbours: { seen: hits.filter((n) => n > 0).length, of: siblings.length, most },
      confidence,
    });
  }

  const wanted = rows.filter(
    (row) =>
      (options.kind === undefined || row.kind === options.kind || row.type === options.kind) &&
      (options.confidence === undefined || row.confidence === options.confidence),
  );
  wanted.sort(
    (a, b) => STRENGTH[a.confidence] - STRENGTH[b.confidence] || b.neighbours.most - a.neighbours.most || byId(a.id, b.id),
  );
  return {
    rows: wanted,
    notes: [...silent].sort(byId).map((service) => `nothing from ${service} in the window`),
    window,
  };
};

/**
 * A best guess traffic went through (P110): a `heuristic` edge whose join the
 * window holds at least once. The join's roll-up row when so. Read beside the
 * confidence, never written into it (I4): a rebuild without the file gives
 * the static answer again.
 */
export const confirmedByTraffic = (
  edge: Pick<GraphEdge, 'from' | 'type' | 'to' | 'confidence'>,
  observed: Pick<ObservedRollUp, 'joins'>,
): Seen | undefined => {
  if (edge.confidence !== 'heuristic') return undefined;
  const seen = observed.joins[joinIdOf(edge.from, edge.type, edge.to)];
  return seen !== undefined && seen.count >= 1 ? seen : undefined;
};

/** Every best guess the window went through, by join id; a join the graph no longer has is left out (§10). */
export const confirmedJoins = (
  db: GraphDb,
  observed: Pick<ObservedRollUp, 'joins'>,
): Array<{ id: string; edge: GraphEdge; seen: Seen }> =>
  Object.keys(observed.joins)
    .sort(byId)
    .flatMap((id) => {
      const join = joinOfId(id);
      if (join === undefined) return [];
      const edge = db.edgesFrom(join.from, [join.type]).find((each) => each.to === join.to);
      const seen = edge === undefined ? undefined : confirmedByTraffic(edge, observed);
      return edge === undefined || seen === undefined ? [] : [{ id, edge, seen }];
    });

/** How many best guesses the graph has, and how many of them traffic went through. */
export const bestGuessCounts = (db: GraphDb, observed: Pick<ObservedRollUp, 'joins'>): { bestGuesses: number; confirmed: number } => {
  const confirmed = confirmedJoins(db, observed).length;
  const bestGuesses = db.allEdges().filter((edge) => edge.confidence === 'heuristic').length;
  return { bestGuesses, confirmed };
};

/**
 * What `dead` reads of traffic (P110): how often a node was seen in the
 * window, and the never-seen row it has. Built once per answer.
 */
export interface TrafficOverlay {
  window: ReadWindow;
  seenOf(id: string): { count: number; lastSeen: string | null } | undefined;
  neverOf(id: string): NeverSeenRow | undefined;
}

export const trafficOverlay = (db: GraphDb, observed: ObservedInput, since?: string): TrafficOverlay => {
  const { counts, window } = observedOver(observed, since);
  const answer = neverSeen(db, observed, since === undefined ? {} : { since });
  const never = new Map(answer.rows.map((row) => [row.id, row]));
  const joined = joinedNodes(counts);
  const handled = handledNodes(db, counts);
  return {
    window,
    seenOf: (id) => {
      const own = counts.entries[id] ?? counts.symbols[id] ?? counts.channels[id];
      if (own !== undefined && own.hits > 0) return { count: own.hits, lastSeen: own.lastSeen ?? null };
      const through = joined.get(id) ?? handled.get(id);
      return through === undefined || through.count === 0 ? undefined : through;
    },
    neverOf: (id) => never.get(id),
  };
};
