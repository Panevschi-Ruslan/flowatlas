import type { GraphEdge } from '@flowatlas/core';
import { edgeIdOf, type Observed } from '../observe/match.js';

/**
 * What `flowatlas observe` saw, keyed the way the page addresses things.
 *
 *   observed: {
 *     joins:   { [edgeId]: { count, lastSeen } },   // edgeId: position in `edges`, as a string
 *     entries: { [entryKey]: { hits } },            // entryKey: entry node id, a key of `entryIds`
 *     unmatched: [{ service?, kind, name }]         // seen at run time, not found in code
 *   }
 *
 * `lastSeen` is an ISO time or null. `kind` of an unmatched span is one of
 * http, client, messaging, code, db, rpc. Present only when `observed.json`
 * sits beside the database.
 */
export interface PackedObserved {
  joins: Record<string, { count: number; lastSeen: string | null }>;
  entries: Record<string, { hits: number }>;
  unmatched: Array<{ service?: string; kind: string; name: string }>;
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
  const unmatched = observed.unmatched.map(({ service, kind, name }) => ({
    ...(service === undefined ? {} : { service }),
    kind,
    name,
  }));
  return { joins, entries, unmatched };
};
