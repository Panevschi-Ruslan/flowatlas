/**
 * What doctor says about the failures traffic answered (P106).
 *
 * Asked at doctor time, never stored: the observed file beside the database
 * holds the statuses each way in answered (P105), and core's
 * `compareSeenFailures` sets them beside what the code declares. One row per
 * way in and status no failure declares, at the handler, and one per declared
 * failure no request answered in the window, at the throw. Both at `info`:
 * traffic differs per environment and per week, and a build must not fail
 * because nobody hit a 409 on Sunday (D3). `--strict-runtime` is there for a
 * team that wants them to count.
 */
import { compareEntryFailures, type FailureComparison, type GraphNode, type Observed, type Unresolved } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';

/** A status a way in answered that no failure in its code declares. */
export const SEEN_UNDECLARED = 'failure-seen-undeclared';

/** A failure the code declares that no request answered in the window. */
export const DECLARED_UNSEEN = 'failure-declared-unseen';

/** Both, for the verdict and the read gate. */
export const RUNTIME_FAILURE_REASONS: ReadonlySet<string> = new Set([SEEN_UNDECLARED, DECLARED_UNSEEN]);

/**
 * Whether a row counts under `--strict-runtime`: every runtime failure row but
 * a status the framework is expected to answer, which says why instead (I3).
 */
export const countsUnderStrictRuntime = (row: Unresolved): boolean =>
  RUNTIME_FAILURE_REASONS.has(row.reason) && row.meta?.['expected'] === undefined;

/** How a way in is named in a sentence: its method and path, else its label. */
const routeOf = (node: GraphNode): string => {
  const method = node.meta?.['method'];
  const path = node.meta?.['path'];
  return typeof method === 'string' && typeof path === 'string' ? `${method} ${path}` : node.label;
};

const windowSay = (comparison: FailureComparison): string =>
  comparison.window.from === null ? 'in no hours held' : `from ${comparison.window.from} to ${comparison.window.to}`;

const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

/** Where a row about a way in sits: its handler where one is drawn, else the entry itself. */
const placeOf = (db: GraphDb, node: GraphNode): { file: string; line: number; symbol: string } => {
  const handler = db.edgesFrom(node.id, ['handles'])[0];
  const at = handler === undefined ? undefined : db.node(handler.to);
  const where = at?.file !== undefined ? at : node;
  return { file: where.file ?? '', line: where.line ?? 0, symbol: at?.id ?? node.id };
};

const splitLoc = (loc: string | undefined): { file?: string; line?: number } => {
  if (loc === undefined) return {};
  const cut = loc.lastIndexOf(':');
  const line = cut < 0 ? Number.NaN : Number(loc.slice(cut + 1));
  return Number.isInteger(line) ? { file: loc.slice(0, cut), line } : { file: loc };
};

/** The rows of one way in's comparison. */
const rowsOf = (db: GraphDb, node: GraphNode, comparison: FailureComparison): Unresolved[] => {
  const route = routeOf(node);
  const place = placeOf(db, node);
  const over = windowSay(comparison);
  const undeclared = comparison.undeclared.map(
    (row): Unresolved => ({
      file: place.file,
      line: place.line,
      reason: SEEN_UNDECLARED,
      level: 'info',
      service: node.repo,
      symbol: place.symbol,
      message:
        `${route} answered ${row.status} to ${row.count} of ${comparison.hits} requests (${percent(row.share)}) ${over}, ` +
        `and no failure in its code declares it` +
        (row.expected === undefined ? '' : `; expected: ${row.expected}`) +
        (row.maybe === undefined ? '' : `; maybe ${row.maybe.join(', ')}, which name no status`),
      meta: {
        entry: node.id,
        status: row.status,
        count: row.count,
        ...(row.expected === undefined ? {} : { expected: row.expected }),
      },
    }),
  );
  const unseen = comparison.declaredNeverSeen.map((row): Unresolved => {
    const at = splitLoc(row.loc);
    return {
      file: at.file ?? place.file,
      line: at.line ?? place.line,
      reason: DECLARED_UNSEEN,
      level: 'info',
      service: node.repo,
      symbol: row.at,
      message:
        `${route} declares ${row.status === undefined ? '' : `${row.status} `}${row.exception}, ` +
        `and none of its ${comparison.hits} requests ${over} answered it`,
      meta: { entry: node.id, exception: row.exception, ...(row.status === undefined ? {} : { status: row.status }) },
    };
  });
  return [...undeclared, ...unseen];
};

/**
 * Every runtime failure row of the ways in the observed file saw and the graph
 * still has; none without an observed file.
 */
export const runtimeFailureRows = (db: GraphDb, observed: Observed | undefined): Unresolved[] => {
  if (observed === undefined) return [];
  return Object.entries(observed.entries)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([id, seen]) => {
      const node = db.node(id);
      if (node?.type !== 'entry') return [];
      const comparison = compareEntryFailures(
        node,
        { count: seen.hits, ...(seen.statuses === undefined ? {} : { statuses: seen.statuses }) },
        { window: observed.window },
      );
      return comparison === undefined ? [] : rowsOf(db, node, comparison);
    });
};
