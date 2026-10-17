import { joinIdOf, type GraphEdge, type Observed } from '@flowatlas/core';
import { wordsOf, type Word } from './dictionary.js';

/**
 * What `flowatlas observe` saw, keyed the way the page addresses things.
 *
 *   observed: {
 *     joins:   { [edgeId]: { count, lastSeen } },   // edgeId: position in `edges`, as a string
 *     entries: { [entryId]: { hits } },             // entryId: entry node id, a key of `entryIds`
 *     unmatched: [[service, kind, name]],           // seen at run time, not found in code
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
 */
export type PackedAmbiguous = [service: Word, kind: Word, name: string, count: number, places: number[], unnamed?: number];

export interface PackedObserved {
  joins: Record<string, { count: number; lastSeen: string | null }>;
  entries: Record<string, { hits: number }>;
  unmatched: Array<[service: Word, kind: Word, name: string]>;
  ambiguous?: PackedAmbiguous[];
  services?: string[];
  kinds?: string[];
}

export const packObserved = (
  observed: Observed,
  packedEdges: readonly GraphEdge[],
  entryIds: Readonly<Record<string, number>>,
  /** Every node's position in `nodes`, by id. */
  position: ReadonlyMap<string, number>,
): PackedObserved => {
  const at = new Map(packedEdges.map((edge, index) => [joinIdOf(edge.from, edge.type, edge.to), index]));
  const joins: PackedObserved['joins'] = {};
  for (const [id, seen] of Object.entries(observed.joins)) {
    const index = at.get(id);
    if (index !== undefined) joins[String(index)] = { count: seen.count, lastSeen: seen.lastSeen };
  }
  const entries: PackedObserved['entries'] = {};
  for (const [id, seen] of Object.entries(observed.entries)) {
    if (entryIds[id] !== undefined) entries[id] = { hits: seen.hits };
  }
  const ambiguousIn = observed.ambiguous ?? [];
  const rows = [...observed.unmatched, ...ambiguousIn];
  const services = wordsOf(
    rows.flatMap(({ service }) => (service === undefined ? [] : [service])),
    'services',
  );
  const kinds = wordsOf(rows.map(({ kind }) => kind), 'kinds');
  const serviceWord = (service: string | undefined): Word => (service === undefined ? -1 : services.word(service));
  const unmatched = observed.unmatched.map(({ service, kind, name }): PackedObserved['unmatched'][number] => [
    serviceWord(service),
    kinds.word(kind),
    name,
  ]);
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
    unmatched,
    ...(ambiguous.length === 0 ? {} : { ambiguous }),
    ...(services.list.length === 0 ? {} : { services: services.list }),
    ...(kinds.list.length === 0 ? {} : { kinds: kinds.list }),
  };
};
