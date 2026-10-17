import {
  blindSpotNext,
  compareEntryFailures,
  comparisonSays,
  joinIdOf,
  type FailureComparison,
  type GraphEdge,
  type GraphNode,
  type MeasuredAt,
  type Observed,
  type ObservedFigures,
  type ObservedWindow,
} from '@flowatlas/core';
import { wordsOf, type Word } from './dictionary.js';

/**
 * What `flowatlas observe` saw, keyed the way the page addresses things.
 *
 *   observed: {
 *     joins:   { [edgeId]: { count, lastSeen, ...stats, measuredAt? } },   // edgeId: position in `edges`, as a string
 *     entries: { [entryId]: { hits, ...stats } },   // entryId: entry node id, a key of `entryIds`
 *     window?: { since?, from, to },                // the hours the counts cover (P105)
 *     failures?: { [entryId]: FailureSeen },        // statuses answered against the failures declared (P106)
 *     unmatched: [[service, kind, name, next?]],    // seen at run time, not found in code; `next` looks for it (P110)
 *     never?: { window, rows: [[node, strong]] },   // what the code runs and traffic never touched (P110)
 *     confirmed?: [edge],                           // best guesses traffic went through (P110)
 *     drift?: { [entryId]: [fields, paths] },       // bodies traffic carried that differ from the code (P113)
 *     ambiguous?: [[service, kind, name, count, places, unnamed?]],  // fit several places (P85)
 *     services?: [name], kinds?: [kind]             // what `service` and `kind` index (P84)
 *   }
 *
 * `lastSeen` is an ISO time or null. A row's `service` is a position in
 * `services`, -1 when the trace names none, and its `kind` one in `kinds`
 * (unmatched: http, client, messaging, code, db, rpc; ambiguous: entry, join,
 * client, symbol, table); either is the word itself where listing it would
 * not pay (`wordsOf`). An ambiguous row's `places` are edge positions for a
 * `join` and node positions otherwise; `unnamed` counts candidates it does not
 * list. `unmatchedOf` and `ambiguousOf` (steps.js) expand the rows. Present
 * only when the observed file sits beside the database.
 *
 * `stats` (P105) are what the file measured, each only when it did: `p50`,
 * `p95`, `max` in milliseconds, `errors`, and `statuses` (status → count).
 * Nothing on the page renders them yet (P111); `createSeen` reads `count`
 * and `hits` as it always has.
 *
 * `failures` (P106) is core's `compareSeenFailures` for each way in seen with
 * a status that has something to say, without the entry id its key already
 * is: the statuses it answered that no failure declares, the declared ones
 * seen and never seen, over `window`. The Steps failure chips and the copied
 * prompt read it; `failSeenOf` (steps.js) hands it out.
 *
 * `never` and `confirmed` (P110) are the linker's `neverSeen` and
 * `confirmedJoins`, worked out by the command over the database and handed
 * in as `traffic`: `never.rows` are node positions with `1` for a strong row
 * (a busy neighbour) and `0` for a weak one, over `never.window` (`2h`);
 * `confirmed` are positions in `edges` of `heuristic` joins the window holds.
 * An unmatched row's `next` is the MCP call that looks for it in the map,
 * the text `cant_follow` names.
 *
 * `drift` (P113) is the contracts package's `compareTraffic` for each way in
 * `observe --shapes` read bodies of whose traffic differs from its code: how
 * many fields, and the paths (`request giftNote`, `200 owner`), worked out by
 * the command and handed in as `traffic.drift`. The Steps header's
 * `traffic differs` chip reads it.
 */
export type PackedAmbiguous = [service: Word, kind: Word, name: string, count: number, places: number[], unnamed?: number];

export interface PackedStats {
  p50?: number;
  p95?: number;
  max?: number;
  errors?: number;
  statuses?: Record<string, number>;
}

/** A comparison as the page holds it: the entry id is its key. */
export type PackedFailuresSeen = Omit<FailureComparison, 'entry'>;

export interface PackedObserved {
  joins: Record<string, { count: number; lastSeen: string | null; measuredAt?: MeasuredAt } & PackedStats>;
  entries: Record<string, { hits: number } & PackedStats>;
  window?: ObservedWindow;
  failures?: Record<string, PackedFailuresSeen>;
  unmatched: Array<[service: Word, kind: Word, name: string, next?: string]>;
  never?: { window: string; rows: Array<[node: number, strong: 0 | 1]> };
  confirmed?: number[];
  drift?: Record<string, [fields: number, paths: string[]]>;
  ambiguous?: PackedAmbiguous[];
  services?: string[];
  kinds?: string[];
}

/** What the command worked out of traffic over the graph (P110), by id: handed in, never computed here. */
export interface PackTraffic {
  never: { window: string; rows: ReadonlyArray<{ id: string; confidence: 'strong' | 'weak' }> };
  /** Join ids of best guesses traffic went through. */
  confirmed: readonly string[];
  /** Ways in whose bodies differ from their code (P113): how many fields, and which. */
  drift?: ReadonlyArray<{ entry: string; fields: number; paths: readonly string[] }>;
}

/** The figures a row measured, each only when it did. */
const statsOf = (seen: ObservedFigures): PackedStats => {
  const stats: PackedStats = {};
  if (seen.p50 !== undefined) stats.p50 = seen.p50;
  if (seen.p95 !== undefined) stats.p95 = seen.p95;
  if (seen.max !== undefined) stats.max = seen.max;
  if (seen.errors !== undefined && seen.errors > 0) stats.errors = seen.errors;
  if (seen.statuses !== undefined) stats.statuses = seen.statuses;
  return stats;
};

export const packObserved = (
  observed: Observed,
  packedEdges: readonly GraphEdge[],
  entryIds: Readonly<Record<string, number>>,
  /** Every node's position in `nodes`, by id. */
  position: ReadonlyMap<string, number>,
  /** The nodes themselves, for what each way in declares it fails with (P106). */
  nodes: readonly GraphNode[] = [],
  traffic?: PackTraffic,
): PackedObserved => {
  const at = new Map(packedEdges.map((edge, index) => [joinIdOf(edge.from, edge.type, edge.to), index]));
  const joins: PackedObserved['joins'] = {};
  for (const [id, seen] of Object.entries(observed.joins)) {
    const index = at.get(id);
    if (index !== undefined) {
      joins[String(index)] = {
        count: seen.count,
        lastSeen: seen.lastSeen,
        ...statsOf(seen),
        ...(seen.measuredAt === undefined ? {} : { measuredAt: seen.measuredAt }),
      };
    }
  }
  const entries: PackedObserved['entries'] = {};
  const failures: Record<string, PackedFailuresSeen> = {};
  for (const [id, seen] of Object.entries(observed.entries)) {
    const at = entryIds[id];
    if (at === undefined) continue;
    entries[id] = { hits: seen.hits, ...statsOf(seen) };
    const node = nodes[at];
    const compared =
      node?.id !== id
        ? undefined
        : compareEntryFailures(
            node,
            { count: seen.hits, ...(seen.statuses === undefined ? {} : { statuses: seen.statuses }) },
            { window: observed.window },
          );
    if (comparisonSays(compared)) {
      const { entry: _entry, ...rest } = compared;
      failures[id] = rest;
    }
  }
  const ambiguousIn = observed.ambiguous ?? [];
  const rows = [...observed.unmatched, ...ambiguousIn];
  const services = wordsOf(
    rows.flatMap(({ service }) => (service === undefined ? [] : [service])),
    'services',
  );
  const kinds = wordsOf(rows.map(({ kind }) => kind), 'kinds');
  const serviceWord = (service: string | undefined): Word => (service === undefined ? -1 : services.word(service));
  const unmatched = observed.unmatched.map(({ service, kind, name }): PackedObserved['unmatched'][number] =>
    traffic === undefined
      ? [serviceWord(service), kinds.word(kind), name]
      : [serviceWord(service), kinds.word(kind), name, blindSpotNext(kind, name, service)],
  );
  const neverRows = (traffic?.never.rows ?? []).flatMap((row): Array<[number, 0 | 1]> => {
    const place = position.get(row.id);
    return place === undefined ? [] : [[place, row.confidence === 'strong' ? 1 : 0]];
  });
  const confirmed = (traffic?.confirmed ?? []).flatMap((id) => {
    const place = at.get(id);
    return place === undefined ? [] : [place];
  });
  const drift: Record<string, [number, string[]]> = {};
  for (const row of traffic?.drift ?? []) if (entryIds[row.entry] !== undefined && row.fields > 0) drift[row.entry] = [row.fields, [...row.paths]];
  const ambiguous = ambiguousIn.map(({ service, kind, name, count, candidates, more }): PackedAmbiguous => {
    const places = candidates.flatMap((id) => {
      const place = kind === 'join' ? at.get(id) : position.get(id);
      return place === undefined ? [] : [place];
    });
    const unnamed = (more ?? 0) + candidates.length - places.length;
    const row: PackedAmbiguous = [serviceWord(service), kinds.word(kind), name, count, places];
    if (unnamed > 0) row.push(unnamed);
    return row;
  });
  return {
    joins,
    entries,
    ...(observed.window === undefined || observed.window.from === null ? {} : { window: observed.window }),
    ...(Object.keys(failures).length === 0 ? {} : { failures }),
    unmatched,
    ...(traffic === undefined ? {} : { never: { window: traffic.never.window, rows: neverRows } }),
    ...(confirmed.length === 0 ? {} : { confirmed }),
    ...(Object.keys(drift).length === 0 ? {} : { drift }),
    ...(ambiguous.length === 0 ? {} : { ambiguous }),
    ...(services.list.length === 0 ? {} : { services: services.list }),
    ...(kinds.list.length === 0 ? {} : { kinds: kinds.list }),
  };
};
