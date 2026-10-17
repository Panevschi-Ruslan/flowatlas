/**
 * What doctor says about traffic beside the map (P110), asked at doctor time
 * and never stored, like the failure rows of `runtime.ts`.
 *
 * - **Blind spots**: one `seen-not-in-code` row per service and kind of span
 *   `observe` matched to nothing, file-less and at `info` (D3): traffic
 *   reached it and no reader drew it. A gap, so `doctor --unresolved` and the
 *   MCP server's `cant_follow` list the same rows under the same cause.
 * - **Best guesses confirmed**: a `heuristic` join the window went through is
 *   counted apart from the best guesses, and the row that explains the guess
 *   (a base address taken from a setting's name, a mount taken as empty) is
 *   withdrawn while it is confirmed. The edge on disk keeps its confidence
 *   (I4): a doctor run without the file says what it said before.
 */
import { blindSpotRows, observedOver, type Observed, type Unresolved } from '@flowatlas/core';
import { confirmedJoins, type GraphDb } from '@flowatlas/linker';

/** One `seen-not-in-code` row per service and kind; core's, so the MCP server counts the same rows. */
export { blindSpotRows };

/**
 * Rows that explain why a join is a best guess, each written at the call the
 * guess leaves from (the hints say "the join is marked heuristic").
 */
export const BEST_GUESS_REASONS: ReadonlySet<string> = new Set([
  'route-mount-assumed-empty',
  'base-url-from-files',
  'base-url-from-name',
  'route-api-guessed',
  'workflow-named-by-file',
  'environment-from-files',
]);

/** What traffic said of the best guesses, for the summary line and the JSON. */
export interface ConfirmedGuesses {
  window: string;
  bestGuesses: number;
  confirmed: number;
  /** Rows explaining a guess left out because traffic went through the join. */
  withdrawn: number;
}

/**
 * The rows with the best-guess explanations of confirmed joins left out, and
 * what was counted. A row stands at the call a join leaves from (its symbol
 * is that node's id); every other row is kept as it was.
 */
export const withConfirmedGuesses = <T extends Pick<Unresolved, 'reason' | 'symbol'>>(
  db: GraphDb,
  observed: Observed | undefined,
  rows: readonly T[],
  /** Only best guesses made from this service's code, as `doctor --service` narrows everything. */
  service?: string,
): { rows: T[]; confirmed?: ConfirmedGuesses } => {
  if (observed === undefined) return { rows: [...rows] };
  const ours = (edge: { from: string }): boolean => service === undefined || db.node(edge.from)?.repo === service;
  const joins = confirmedJoins(db, observed).filter((join) => ours(join.edge));
  const from = new Set(joins.map((join) => join.edge.from));
  const kept = rows.filter((row) => !(BEST_GUESS_REASONS.has(row.reason) && row.symbol !== undefined && from.has(row.symbol)));
  const bestGuesses = db.allEdges().filter((edge) => edge.confidence === 'heuristic' && ours(edge)).length;
  return {
    rows: kept,
    confirmed: { window: observedOver(observed).window.label, bestGuesses, confirmed: joins.length, withdrawn: rows.length - kept.length },
  };
};

/** `1 of 5 best guesses confirmed by traffic in 2h`, or nothing when there is no guess to speak of. */
export const confirmedLine = (confirmed: ConfirmedGuesses | undefined): string | undefined => {
  if (confirmed === undefined || confirmed.bestGuesses === 0) return undefined;
  const withdrawn =
    confirmed.withdrawn === 0 ? '' : `; ${confirmed.withdrawn} row${confirmed.withdrawn === 1 ? '' : 's'} explaining a guess left out`;
  return `${confirmed.confirmed} of ${confirmed.bestGuesses} best guess${confirmed.bestGuesses === 1 ? '' : 'es'} confirmed by traffic in ${confirmed.window}${withdrawn}`;
};
