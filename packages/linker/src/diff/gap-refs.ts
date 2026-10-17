/**
 * The gaps and findings one revision has that the other does not, by gap id
 * (P96).
 *
 * "Three more unresolved" says nothing; "a new `call-dynamic-receiver` in
 * `OrdersService.create`" is a place to look. So the diff keeps the rows, one
 * per gap id (`gap:<service>|<file>|<reason>`, the id `flowatlas accept` and
 * every tool take), rather than the counts alone.
 */
import { gapIdOf, kindOfRow, placeIdOf, wasMissed, type GraphNode, type Unresolved } from '@flowatlas/core';
import type { GapRef, GapRefKind, UnresolvedDiff } from './types.js';

/** As much of a graph as this reads. */
export type GapGraph = { nodes: readonly GraphNode[]; unresolved: readonly Unresolved[] };

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What a row is about, for a diff: a place the reader missed, or something
 * said about the code. Notes say how a join was made, and a gap with no edge
 * to draw is no place to look; neither is listed.
 */
const kindOf = (row: Unresolved): GapRefKind | undefined =>
  wasMissed(row) ? 'gap' : kindOfRow(row) === 'finding' && row.level !== 'nothing' ? 'finding' : undefined;

/** One side's gap ids, each with its first row's place and the places all of its rows stand for. */
export const gapRefsOf = (graph: GapGraph): Map<string, GapRef> => {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const has = (id: string): boolean => ids.has(id);
  const rows = [...graph.unresolved].sort(
    (a, b) => byText(a.service ?? '', b.service ?? '') || byText(a.file, b.file) || a.line - b.line,
  );
  const refs = new Map<string, GapRef>();
  for (const row of rows) {
    const kind = kindOf(row);
    if (kind === undefined) continue;
    const id = gapIdOf(row);
    const held = refs.get(id);
    if (held !== undefined) {
      held.sites += row.sites ?? 1;
      if (held.node === undefined) {
        const node = placeOf(row, has);
        if (node !== undefined) held.node = node;
      }
      continue;
    }
    const node = placeOf(row, has);
    refs.set(id, {
      id,
      kind,
      service: row.service ?? '',
      file: row.file,
      ...(row.line > 0 ? { line: row.line } : {}),
      reason: row.reason,
      ...(node === undefined ? {} : { node }),
      sites: row.sites ?? 1,
    });
  }
  return refs;
};

const placeOf = (row: Unresolved, has: (id: string) => boolean): string | undefined =>
  placeIdOf(
    {
      file: row.file,
      line: row.line,
      ...(row.symbol === undefined ? {} : { symbol: row.symbol }),
      ...(row.service === undefined ? {} : { service: row.service }),
    },
    has,
  );

/** Gap ids the head has and the base does not, and the other way round, each sorted by id. */
export const diffUnresolved = (base: GapGraph, head: GapGraph): UnresolvedDiff => {
  const before = gapRefsOf(base);
  const after = gapRefsOf(head);
  const only = (side: Map<string, GapRef>, other: Map<string, GapRef>): GapRef[] =>
    [...side.values()].filter((ref) => !other.has(ref.id)).sort((a, b) => byText(a.id, b.id));
  return { added: only(after, before), removed: only(before, after) };
};
