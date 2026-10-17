import type { GraphEdge } from '@flowatlas/core';
import { edgeIdOf, type Observed } from '../observe/match.js';
import { wordsOf, type Word } from './dictionary.js';

/**
 * What `flowatlas observe` saw, keyed the way the page addresses things.
 *
 *   observed: {
 *     joins:   { [edgeId]: { count, lastSeen } },   // edgeId: position in `edges`, as a string
 *     entries: { [entryKey]: { hits } },            // entryKey: entry node id, a key of `entryIds`
 *     unmatched: [[service, kind, name]],           // seen at run time, not found in code
 *     services?: [name], kinds?: [kind]             // what `service` and `kind` index (P84)
 *   }
 *
 * `lastSeen` is an ISO time or null. An unmatched span's `service` is a
 * position in `services`, -1 when the trace names none, and its `kind` one in
 * `kinds` (http, client, messaging, code, db, rpc); either is the word itself
 * where listing it would not pay (`wordsOf`). Names are mostly distinct and
 * ship as they are. `unmatchedOf` (steps.js) expands the rows back to
 * `{ service?, kind, name }`. Present only when `observed.json` sits beside
 * the database.
 */
export interface PackedObserved {
  joins: Record<string, { count: number; lastSeen: string | null }>;
  entries: Record<string, { hits: number }>;
  unmatched: Array<[service: Word, kind: Word, name: string]>;
  services?: string[];
  kinds?: string[];
}

export const packObserved = (
  observed: Observed,
  packedEdges: readonly GraphEdge[],
  entryIds: Readonly<Record<string, number>>,
): PackedObserved => {
  const at = new Map(packedEdges.map((edge, index) => [edgeIdOf(edge), index]));
  const joins: PackedObserved['joins'] = {};
  for (const [id, seen] of Object.entries(observed.joins)) {
    const index = at.get(id);
    if (index !== undefined) joins[String(index)] = { count: seen.count, lastSeen: seen.lastSeen };
  }
  const entries: PackedObserved['entries'] = {};
  for (const [id, seen] of Object.entries(observed.entries)) {
    if (entryIds[id] !== undefined) entries[id] = { hits: seen.hits };
  }
  const services = wordsOf(
    observed.unmatched.flatMap(({ service }) => (service === undefined ? [] : [service])),
    'services',
  );
  const kinds = wordsOf(observed.unmatched.map(({ kind }) => kind), 'kinds');
  const unmatched = observed.unmatched.map(({ service, kind, name }): PackedObserved['unmatched'][number] => [
    service === undefined ? -1 : services.word(service),
    kinds.word(kind),
    name,
  ]);
  return {
    joins,
    entries,
    unmatched,
    ...(services.list.length === 0 ? {} : { services: services.list }),
    ...(kinds.list.length === 0 ? {} : { kinds: kinds.list }),
  };
};
