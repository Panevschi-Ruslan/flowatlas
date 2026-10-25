import {
  compileAccepted,
  type AcceptedProblem,
  type AcceptedRead,
  type AcceptedSplit,
  type GapLike,
} from '@flowatlas/core';
import { withAnsweredDemoted, type DemotableRow } from '../answered.js';
import type { GraphDb } from './reader.js';

/**
 * The one split every surface that hides accepted rows goes through (P80).
 *
 * Doctor's report, `doctor --unresolved`, `shapes --suggest`, the page and the
 * MCP server's `cant_follow` and `search` each used to split the rows their own
 * way: one demoted answered rows and one did not, one matched a route rule on a
 * row read back without its symbol and the others did not, so a rule took a row
 * on one surface and left it on the next. Here it is done once, in three steps:
 *
 * 1. a row an annotation already answers is demoted to `info` (R36);
 * 2. a row that carries neither a symbol nor a node is matched on the node the
 *    database keeps for it, found by where it is and what it says;
 * 3. the rows are split by the accepted entries, compiled once.
 *
 * A file that could not be read accepts nothing, and its problem is handed
 * back for the surface to say.
 */
export interface SplitRow extends DemotableRow {
  message?: string | null;
}

export interface AcceptedSplitOf<T> extends AcceptedSplit<T> {
  /** Every row in the order given, demoted where an annotation answered it. */
  rows: T[];
  /** Why `accepted.json` accepted nothing, when it could not be read. */
  problem?: AcceptedProblem;
}

type SplitDb = Pick<GraphDb, 'node' | 'nodesByType' | 'allNodes' | 'edgesFrom' | 'edgesTo' | 'allUnresolved'>;

const anchorKey = (row: SplitRow): string =>
  [row.service ?? '', row.file ?? '', row.line ?? 0, row.reason, row.message ?? ''].join('\u0000');

/** What each row in the database is about, by where it is and what it says. */
const anchorsOf = (db: SplitDb): Map<string, string> => {
  const out = new Map<string, string>();
  for (const row of db.allUnresolved()) if (row.node !== null) out.set(anchorKey(row), row.node);
  return out;
};

/** Whether a row says nothing of what it is about, so the database has to be asked. */
const unanchored = (row: SplitRow): boolean => row.symbol === undefined && row.node === undefined;

export const acceptedSplitOf = <T extends SplitRow>(
  db: SplitDb,
  rows: readonly T[],
  read: AcceptedRead,
): AcceptedSplitOf<T> => {
  // Read only when a row needs it: rows read off the database carry their node.
  const anchors = rows.some(unanchored) ? anchorsOf(db) : undefined;
  const about = (row: T): string | undefined =>
    row.symbol ?? row.node ?? (anchors === undefined ? undefined : anchors.get(anchorKey(row)));
  const demoted = withAnsweredDemoted(rows, db, about);
  // Matched on what the row is about, looked up for the match alone: the rows
  // themselves, and the baseline keys made of them, stay as they were read.
  const matchedAs = (row: T): GapLike => ({
    reason: row.reason,
    service: row.service ?? null,
    file: row.file ?? null,
    symbol: about(row) ?? null,
  });
  const split = compileAccepted(read.gaps).split(demoted, matchedAs);
  return { ...split, rows: demoted, ...(read.problem === undefined ? {} : { problem: read.problem }) };
};
