/**
 * The gaps and findings one revision has that the other does not, by gap id
 * (P96), and by site within a gap id both revisions hold (P194).
 *
 * "Three more unresolved" says nothing; "a new `call-dynamic-receiver` in
 * `OrdersService.create`" is a place to look. So the diff keeps the rows, one
 * per gap id (`gap:<service>|<file>|<reason>`, the id `flowatlas accept` and
 * every tool take), rather than the counts alone.
 *
 * A gap id is one reason in one file, so a second unjoined request in a file
 * that already had one keeps the id it had. The rows under an id both sides
 * hold are therefore matched one by one, on what each says rather than on its
 * line, and the sites left over on either side are listed under the same id
 * with `kept`, the sites the two sides share.
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

const sitesOf = (row: Unresolved): number => row.sites ?? 1;

/** One side's listed rows, grouped by gap id, each group in file order. */
const rowsById = (graph: GapGraph): Map<string, Unresolved[]> => {
  const rows = [...graph.unresolved].sort(
    (a, b) => byText(a.service ?? '', b.service ?? '') || byText(a.file, b.file) || a.line - b.line,
  );
  const groups = new Map<string, Unresolved[]>();
  for (const row of rows) {
    if (kindOf(row) === undefined) continue;
    const id = gapIdOf(row);
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [row]);
    else group.push(row);
  }
  return groups;
};

const hasOf = (graph: GapGraph): ((id: string) => boolean) => {
  const ids = new Set(graph.nodes.map((node) => node.id));
  return (id) => ids.has(id);
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

/** A gap id read off some of its rows: the first one's place, the first method any of them is in. */
const refOf = (id: string, rows: readonly Unresolved[], sites: number, has: (id: string) => boolean): GapRef => {
  const first = rows[0]!;
  let node: string | undefined;
  for (const row of rows) {
    node = placeOf(row, has);
    if (node !== undefined) break;
  }
  return {
    id,
    kind: kindOf(first)!,
    service: first.service ?? '',
    file: first.file,
    ...(first.line > 0 ? { line: first.line } : {}),
    reason: first.reason,
    ...(node === undefined ? {} : { node }),
    sites,
  };
};

/** One side's gap ids, each with its first row's place and the places all of its rows stand for. */
export const gapRefsOf = (graph: GapGraph): Map<string, GapRef> => {
  const has = hasOf(graph);
  const refs = new Map<string, GapRef>();
  for (const [id, rows] of rowsById(graph)) {
    refs.set(id, refOf(id, rows, rows.reduce((sum, row) => sum + sitesOf(row), 0), has));
  }
  return refs;
};

/**
 * What a row says, with its position taken out: the symbol and the message.
 *
 * A request's symbol is its node id, which ends in `:<line>:<column>`, so two
 * requests in one file differ by the route the message names; a receiver's is
 * its source text. The line, and any `:<line>:<column>` inside the text, is
 * masked: inserting an import above a gap moves it without making it new.
 * `meta` is left out, since counts and samples in it move with code elsewhere.
 */
const sayingOf = (row: Unresolved): string =>
  JSON.stringify([(row.symbol ?? '').replace(/:\d+:\d+/g, ':_:_'), row.message ?? '']);

/**
 * One side's sites under one gap id: those that stand for themselves, by what
 * each says, and those a folded row stands for (more than one site on a row,
 * R07), which can only be counted.
 */
type Sites = { said: Map<string, Unresolved[]>; folded: Unresolved[]; foldedSites: number };

const sitesUnder = (rows: readonly Unresolved[]): Sites => {
  const sites: Sites = { said: new Map(), folded: [], foldedSites: 0 };
  for (const row of rows) {
    if (sitesOf(row) > 1) {
      sites.folded.push(row);
      sites.foldedSites += sitesOf(row);
      continue;
    }
    const saying = sayingOf(row);
    const same = sites.said.get(saying);
    if (same === undefined) sites.said.set(saying, [row]);
    else same.push(row);
  }
  return sites;
};

/** What one gap id's rows on each side add up to against the other's. */
type SiteDiff = { added: Unresolved[]; addedSites: number; removed: Unresolved[]; removedSites: number; kept: number };

/**
 * Match one gap id's sites across the sides.
 *
 * Rows that say the same thing match first, as many as both sides have; then
 * a folded row's count takes up the other side's leftovers (a site folded on
 * one side and standing alone on the other is the same site); then the two
 * sides' folded counts meet. What is left on either side is new or gone.
 */
const matchSites = (base: readonly Unresolved[], head: readonly Unresolved[]): SiteDiff => {
  const before = sitesUnder(base);
  const after = sitesUnder(head);
  let kept = 0;
  let leftBefore: Unresolved[] = [];
  let leftAfter: Unresolved[] = [];
  for (const [saying, rows] of after.said) {
    const had = before.said.get(saying) ?? [];
    const both = Math.min(had.length, rows.length);
    kept += both;
    leftAfter.push(...rows.slice(both));
  }
  for (const [saying, rows] of before.said) {
    const has = after.said.get(saying)?.length ?? 0;
    leftBefore.push(...rows.slice(Math.min(has, rows.length)));
  }
  let foldedBefore = before.foldedSites;
  let foldedAfter = after.foldedSites;
  const intoAfter = Math.min(leftBefore.length, foldedAfter);
  leftBefore = leftBefore.slice(intoAfter);
  foldedAfter -= intoAfter;
  const intoBefore = Math.min(leftAfter.length, foldedBefore);
  leftAfter = leftAfter.slice(intoBefore);
  foldedBefore -= intoBefore;
  const folded = Math.min(foldedBefore, foldedAfter);
  foldedBefore -= folded;
  foldedAfter -= folded;
  kept += intoAfter + intoBefore + folded;
  const inLineOrder = (rows: Unresolved[]): Unresolved[] => rows.sort((a, b) => a.line - b.line);
  return {
    added: inLineOrder([...leftAfter, ...(foldedAfter > 0 ? after.folded : [])]),
    addedSites: leftAfter.length + foldedAfter,
    removed: inLineOrder([...leftBefore, ...(foldedBefore > 0 ? before.folded : [])]),
    removedSites: leftBefore.length + foldedBefore,
    kept,
  };
};

/**
 * Gap ids the head has and the base does not, and the other way round, each
 * sorted by id; and, under the same id, the sites a gap id both sides hold
 * gained (in `added`) or lost (in `removed`), with `kept`.
 */
export const diffUnresolved = (base: GapGraph, head: GapGraph): UnresolvedDiff => {
  const before = rowsById(base);
  const after = rowsById(head);
  const hasBefore = hasOf(base);
  const hasAfter = hasOf(head);
  const added: GapRef[] = [];
  const removed: GapRef[] = [];
  const total = (rows: readonly Unresolved[]): number => rows.reduce((sum, row) => sum + sitesOf(row), 0);
  for (const [id, rows] of after) {
    const had = before.get(id);
    if (had === undefined) {
      added.push(refOf(id, rows, total(rows), hasAfter));
      continue;
    }
    const sites = matchSites(had, rows);
    if (sites.addedSites > 0) added.push({ ...refOf(id, sites.added, sites.addedSites, hasAfter), kept: sites.kept });
    if (sites.removedSites > 0) {
      removed.push({ ...refOf(id, sites.removed, sites.removedSites, hasBefore), kept: sites.kept });
    }
  }
  for (const [id, rows] of before) {
    if (!after.has(id)) removed.push(refOf(id, rows, total(rows), hasBefore));
  }
  const sorted = (refs: GapRef[]): GapRef[] => refs.sort((a, b) => byText(a.id, b.id));
  return { added: sorted(added), removed: sorted(removed) };
};
