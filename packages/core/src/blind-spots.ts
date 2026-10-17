/**
 * What traffic reached that no reader drew (P110): the spans `observe`
 * matched to nothing (`unmatched`, P65 and P107), grouped by service and
 * kind, as the rows `doctor`, `doctor --unresolved` and the MCP server's
 * `cant_follow` list under one cause.
 *
 * A blind spot is a question for a reader, never an answer: no edge is drawn
 * from one and nothing in the graph changes. The group says how often and how
 * lately, the names the trace kept (a route template, a destination, a
 * `Class.method`, a table, an rpc name - only what the allow-list kept), and
 * the call that looks for it in the map.
 */
import type { Unresolved } from './model/graph.js';
import { observedOver, type Observed, type UnmatchedKind, type UnmatchedSpan } from './observed.js';

/** The cause, and the reason of the rows that carry it. */
export const SEEN_NOT_IN_CODE = 'seen-not-in-code';

/** How many names one group lists; the rest are counted. */
export const BLIND_SPOT_NAMES = 5;

/** One name traffic used, with how often and how lately. */
export interface BlindSpotName {
  name: string;
  count: number;
  lastSeen: string | null;
}

/** Everything one service's traffic reached of one kind that the map does not draw. */
export interface BlindSpot {
  service?: string;
  kind: UnmatchedKind | string;
  /** Spans, over every name of the group. */
  count: number;
  /** Distinct names, listed or not. */
  places: number;
  lastSeen: string | null;
  names: BlindSpotName[];
  /** Names past the ones listed. */
  more?: number;
  /** What to ask next, as an MCP call. */
  next: string[];
}

/** A call as the MCP server writes one in `next`: `search({query: "orders"})`. */
const call = (tool: string, args: Readonly<Record<string, string | undefined>>): string => {
  const said = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `${tool}(${said.length === 0 ? '' : `{${said.join(', ')}}`})`;
};

/** The path of a route a span said (`GET /orders/:value`), which is what a search finds it by. */
const pathOf = (name: string): string => name.split(' ').pop() ?? name;

/**
 * What looks for a blind spot in the map, by kind (a Strategy): a symbol by
 * its name, a route a service answers among its ways in, anything else by the
 * words the trace kept.
 */
const NEXT_BY_KIND: Readonly<Record<string, (name: string, service?: string) => string>> = {
  code: (name, service) => call('find_symbol', { query: name, service }),
  http: (_name, service) => call('list_entries', { service }),
  client: (name) => call('search', { query: pathOf(name) }),
};

const searchFor = (name: string): string => call('search', { query: name });

/** The one call that looks for a name in the map. */
export const blindSpotNext = (kind: string, name: string, service?: string): string =>
  (NEXT_BY_KIND[kind] ?? searchFor)(name, service);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const later = (a: string | null, b: string | null | undefined): string | null =>
  b === undefined || b === null ? a : a === null || b > a ? b : a;

export interface BlindSpotOptions {
  /** Only this service's. */
  service?: string;
  /** Most names a group lists. Default `BLIND_SPOT_NAMES`. */
  names?: number;
}

/**
 * The unmatched rows of a roll-up as groups: one per service and kind, most
 * spans first, then by service and kind; within a group, names most spans
 * first, then by name. `next` names the busiest place's search, and for an
 * http group the service's ways in.
 */
export const blindSpotsOf = (unmatched: readonly UnmatchedSpan[], options: BlindSpotOptions = {}): BlindSpot[] => {
  const most = options.names ?? BLIND_SPOT_NAMES;
  const groups = new Map<string, { service?: string; kind: string; rows: UnmatchedSpan[] }>();
  for (const row of unmatched) {
    if (options.service !== undefined && row.service !== options.service) continue;
    const key = `${row.service ?? ''}\u0000${row.kind}`;
    const group = groups.get(key) ?? { ...(row.service === undefined ? {} : { service: row.service }), kind: row.kind, rows: [] };
    groups.set(key, group);
    group.rows.push(row);
  }
  return [...groups.values()]
    .map((group): BlindSpot => {
      const byName = new Map<string, BlindSpotName>();
      for (const row of group.rows) {
        const had = byName.get(row.name) ?? { name: row.name, count: 0, lastSeen: null };
        byName.set(row.name, { name: row.name, count: had.count + row.count, lastSeen: later(had.lastSeen, row.lastSeen) });
      }
      const names = [...byName.values()].sort((a, b) => b.count - a.count || cmp(a.name, b.name));
      const top = names[0];
      return {
        ...(group.service === undefined ? {} : { service: group.service }),
        kind: group.kind,
        count: names.reduce((sum, name) => sum + name.count, 0),
        places: names.length,
        lastSeen: names.reduce<string | null>((at, name) => later(at, name.lastSeen), null),
        names: names.slice(0, most),
        ...(names.length > most ? { more: names.length - most } : {}),
        next: top === undefined ? [] : [blindSpotNext(group.kind, top.name, group.service)],
      };
    })
    .sort((a, b) => b.count - a.count || cmp(a.service ?? '', b.service ?? '') || cmp(a.kind, b.kind));
};

/** What one kind of blind spot is, in words, for a sentence: `2 routes`, `1 table`. */
const KIND_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  http: ['route', 'routes'],
  client: ['outbound request', 'outbound requests'],
  messaging: ['destination', 'destinations'],
  code: ['method', 'methods'],
  db: ['collection', 'collections'],
  rpc: ['rpc method', 'rpc methods'],
  function: ['function', 'functions'],
  workflow: ['workflow', 'workflows'],
  state: ['workflow step', 'workflow steps'],
  table: ['table', 'tables'],
  cloud: ['cloud call', 'cloud calls'],
  join: ['join', 'joins'],
  external: ['outside host', 'outside hosts'],
  peer: ['peer service', 'peer services'],
};

/** `2 routes`, `1 cloud call`; a kind with no words of its own is said as itself. */
export const blindSpotPlaces = (kind: string, places: number): string => {
  const [one, many] = KIND_WORDS[kind] ?? [`${kind} place`, `${kind} places`];
  return `${places} ${places === 1 ? one : many}`;
};

/** The sentence a doctor row says for one group, over a window said in words (`2h`). */
export const blindSpotMessage = (spot: BlindSpot, window: string): string => {
  const listed = spot.names.map((name) => `${name.name} (${name.count})`).join(', ');
  return (
    `traffic${spot.service === undefined ? '' : ` in ${spot.service}`} reached ${blindSpotPlaces(spot.kind, spot.places)} ` +
    `no reader drew, ${spot.count} span${spot.count === 1 ? '' : 's'} in ${window}: ${listed}` +
    (spot.more === undefined ? '' : `, and ${spot.more} more`)
  );
};

/**
 * One row per group, as doctor, `doctor --unresolved` and `cant_follow`
 * count them: a gap at `info` with no file (D3), standing for as many places
 * as the group has names, carrying the group under `meta.seen`. Over the
 * file's whole window; none without a file.
 */
export const blindSpotRows = (observed: Pick<Observed, 'unmatched' | 'buckets' | 'window'> | undefined): Unresolved[] => {
  if (observed === undefined) return [];
  const window = observedOver(observed).window.label;
  return blindSpotsOf(observed.unmatched).map(
    (spot): Unresolved => ({
      file: '',
      line: 0,
      reason: SEEN_NOT_IN_CODE,
      level: 'info',
      sites: spot.places,
      ...(spot.service === undefined ? {} : { service: spot.service }),
      message: blindSpotMessage(spot, window),
      meta: { seen: spot, window },
    }),
  );
};
