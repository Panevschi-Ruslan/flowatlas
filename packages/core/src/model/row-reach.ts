/**
 * How far a row's place is reached from, where the row says (P89).
 *
 * A loop that runs a query per item records how many ways in of its service
 * reach it (`meta.waysIn`), and every surface that lists such rows puts the
 * busiest first: doctor, the MCP search and prompt, the page. One reading of
 * the field, here, so they cannot come to rank differently.
 */
interface ReachedRow {
  meta?: Record<string, unknown> | null | undefined;
}

/** The ways in a row records, when it records them. */
export const waysInOf = (row: ReachedRow): number | undefined => {
  const ways = row.meta?.['waysIn'];
  return typeof ways === 'number' ? ways : undefined;
};

/**
 * The rows that record their ways in (as `waysOf` reads them), most first,
 * each in a place one of them held; every other row keeps its place. Stable, so rows reached alike
 * keep the order they came in.
 */
export const rankByReach = <T>(rows: readonly T[], waysOf: (row: T) => number | undefined): T[] => {
  const places = rows.flatMap((row, index) => (waysOf(row) === undefined ? [] : [index]));
  const ranked = places
    .map((index) => rows[index] as T)
    .sort((a, b) => (waysOf(b) ?? 0) - (waysOf(a) ?? 0));
  const out = [...rows];
  places.forEach((index, at) => {
    out[index] = ranked[at] as T;
  });
  return out;
};
