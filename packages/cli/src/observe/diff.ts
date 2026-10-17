import { promptMsSay, promptRateSay, type ObservedFigures, type ObservedWindow } from '@flowatlas/core';

/**
 * Two observed files side by side (P111): what got slower, what fails more,
 * and what was seen in one and not the other - before and after a deploy,
 * this week against last. Pure: the command reads the files and hands their
 * roll-ups in; `flowatlas visualise --observed-diff` and `flowatlas observe
 * --diff` both list what this returns.
 */

/** What a diff reads of an observed file: its roll-up rows and its window. */
export interface ObservedDiffInput {
  joins: Readonly<Record<string, ObservedFigures & { count: number }>>;
  entries: Readonly<Record<string, ObservedFigures & { hits: number }>>;
  window?: ObservedWindow;
}

export type DiffKind = 'entry' | 'join';

/** One entry or join as both files saw it; `a` first, `b` second. A figure is undefined where that file did not measure it. */
export interface ObservedDiffRow {
  kind: DiffKind;
  id: string;
  count: [number, number];
  p95: [number | undefined, number | undefined];
  errorRate: [number | undefined, number | undefined];
  /** Statuses `b` answered with that `a` never did, sorted; empty when `a` recorded none (it could not say). */
  newStatuses: string[];
  /** Seen in `a` and not in `b`. */
  gone: boolean;
  /** Seen in `b` and not in `a`. */
  new: boolean;
}

export interface ObservedDiff {
  windows: [ObservedWindow | null, ObservedWindow | null];
  /** The floor both sides must reach before a time or a failure share is compared (D3). */
  minCount: number;
  /** Whether each file measured any time at all (a format-1 file did not). */
  timed: [boolean, boolean];
  /** p95 up by at least `DIFF_SLOWER` (a share) and a millisecond. */
  slower: ObservedDiffRow[];
  /** Error rate up by at least `DIFF_FAILING` (a share), or a new 5xx status. */
  failing: ObservedDiffRow[];
  appeared: ObservedDiffRow[];
  gone: ObservedDiffRow[];
  /** Rows seen on both sides that one side saw fewer than `minCount` times: not compared. */
  tooFew: number;
}

/** The fewest requests on each side before a percentage means anything (D3): a route hit twice is not "40% slower". */
export const DIFF_MIN_COUNT = 20;
/** How much slower a p95 must be to be listed: a tenth, and at least `DIFF_SLOWER_MS`. */
export const DIFF_SLOWER = 0.1;
export const DIFF_SLOWER_MS = 1;
/** How much more must fail to be listed: one request in a hundred more. */
export const DIFF_FAILING = 0.01;

type Figured = ObservedFigures & { n: number };

const statusesOf = (row: Figured | undefined): string[] => Object.keys(row?.statuses ?? {});

const rowOf = (kind: DiffKind, id: string, a: Figured | undefined, b: Figured | undefined): ObservedDiffRow => {
  const had = new Set(statusesOf(a));
  return {
    kind,
    id,
    count: [a?.n ?? 0, b?.n ?? 0],
    p95: [a?.p95, b?.p95],
    errorRate: [a?.errorRate, b?.errorRate],
    newStatuses: a?.statuses === undefined ? [] : statusesOf(b).filter((status) => !had.has(status)).sort(),
    gone: a !== undefined && b === undefined,
    new: a === undefined && b !== undefined,
  };
};

/** How much a row's p95 rose, in ms; 0 when either side did not measure it. */
export const p95Rise = (row: ObservedDiffRow): number =>
  row.p95[0] === undefined || row.p95[1] === undefined ? 0 : row.p95[1] - row.p95[0];

/** How much a row's error rate rose; 0 when either side could not say. */
export const errorRise = (row: ObservedDiffRow): number =>
  row.errorRate[0] === undefined || row.errorRate[1] === undefined ? 0 : row.errorRate[1] - row.errorRate[0];

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The largest p95 rise first, then the largest error-rate rise, then the largest change in traffic, then the id. */
const byChange = (a: ObservedDiffRow, b: ObservedDiffRow): number =>
  p95Rise(b) - p95Rise(a) ||
  errorRise(b) - errorRise(a) ||
  Math.abs(b.count[1] - b.count[0]) - Math.abs(a.count[1] - a.count[0]) ||
  cmp(a.kind, b.kind) ||
  cmp(a.id, b.id);

const isSlower = (row: ObservedDiffRow): boolean => {
  const [before, after] = row.p95;
  if (before === undefined || after === undefined) return false;
  return after - before >= Math.max(DIFF_SLOWER_MS, before * DIFF_SLOWER);
};

const isFailingMore = (row: ObservedDiffRow): boolean =>
  errorRise(row) >= DIFF_FAILING || row.newStatuses.some((status) => Number(status) >= 500);

const measured = (input: ObservedDiffInput): boolean =>
  [...Object.values(input.joins), ...Object.values(input.entries)].some((row) => row.p95 !== undefined);

/**
 * `a` against `b`, entry by entry and join by join. `keep(kind, id)` decides
 * which ids are compared at all - the page keeps only what its graph still
 * holds - and every row is sorted by the largest p95 rise, then error-rate
 * rise, then traffic change.
 */
export const diffObserved = (
  a: ObservedDiffInput,
  b: ObservedDiffInput,
  options: { minCount?: number; keep?: (kind: DiffKind, id: string) => boolean } = {},
): ObservedDiff => {
  const minCount = options.minCount ?? DIFF_MIN_COUNT;
  const keep = options.keep ?? (() => true);
  const rows: ObservedDiffRow[] = [];
  const sides: Array<[DiffKind, (input: ObservedDiffInput) => Record<string, Figured>]> = [
    ['entry', (input) => Object.fromEntries(Object.entries(input.entries).map(([id, row]) => [id, { ...row, n: row.hits }]))],
    ['join', (input) => Object.fromEntries(Object.entries(input.joins).map(([id, row]) => [id, { ...row, n: row.count }]))],
  ];
  for (const [kind, rowsOf] of sides) {
    const before = rowsOf(a);
    const after = rowsOf(b);
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (keep(kind, id)) rows.push(rowOf(kind, id, before[id], after[id]));
    }
  }
  rows.sort(byChange);
  const compared = rows.filter((row) => !row.new && !row.gone);
  const enough = compared.filter((row) => row.count[0] >= minCount && row.count[1] >= minCount);
  return {
    windows: [a.window ?? null, b.window ?? null],
    minCount,
    timed: [measured(a), measured(b)],
    slower: enough.filter(isSlower),
    failing: enough.filter(isFailingMore).sort((x, y) => errorRise(y) - errorRise(x) || byChange(x, y)),
    appeared: rows.filter((row) => row.new).sort((x, y) => y.count[1] - x.count[1] || byChange(x, y)),
    gone: rows.filter((row) => row.gone).sort((x, y) => y.count[0] - x.count[0] || byChange(x, y)),
    tooFew: compared.length - enough.length,
  };
};

/* ── As text, for `flowatlas observe --diff` ── */

/** A file's window in words, or that it holds none. */
export const windowSay = (window: ObservedWindow | null): string =>
  window === null || window.from === null ? 'no hours' : `${window.from.slice(0, 16).replace('T', ' ')} to ${(window.to ?? window.from).slice(0, 16).replace('T', ' ')} UTC`;

const msOrNot = (ms: number | undefined, side: 'a' | 'b'): string => (ms === undefined ? `not in ${side}` : promptMsSay(ms));
const rateOrNot = (rate: number | undefined, side: 'a' | 'b'): string => (rate === undefined ? `not in ${side}` : promptRateSay(rate));

/** One row's change in words: `73 ms → 140 ms (+92%)`, `0% → 4.5% errors`, `22 → 25 requests`. */
export const changeSay = (row: ObservedDiffRow, what: 'time' | 'errors' | 'count'): string => {
  if (what === 'time') {
    const [before, after] = row.p95;
    const share = before !== undefined && after !== undefined && before > 0 ? ` (+${Math.round(((after - before) / before) * 100)}%)` : '';
    return `p95 ${msOrNot(before, 'a')} → ${msOrNot(after, 'b')}${share}`;
  }
  if (what === 'errors') {
    const added = row.newStatuses.length === 0 ? '' : `, new ${row.newStatuses.join(', ')}`;
    return `errors ${rateOrNot(row.errorRate[0], 'a')} → ${rateOrNot(row.errorRate[1], 'b')}${added}`;
  }
  return `${row.count[0]} → ${row.count[1]} requests`;
};

const requests = (n: number): string => `${n} ${n === 1 ? 'request' : 'requests'}`;

/** The diff as the terminal prints it: both windows, then the four lists, each row the id and its change. */
export const diffLines = (diff: ObservedDiff, names: [string, string] = ['a', 'b']): string[] => {
  const lines = [
    `Run time changes: ${names[0]} (${windowSay(diff.windows[0])}) → ${names[1]} (${windowSay(diff.windows[1])})`,
  ];
  if (!diff.timed[0] || !diff.timed[1]) {
    lines.push(`  ${!diff.timed[0] ? names[0] : names[1]} measured no times (an older file): only counts are compared`);
  }
  const list = (title: string, rows: readonly ObservedDiffRow[], say: (row: ObservedDiffRow) => string, none: string): void => {
    lines.push('', `${title} · ${rows.length}`);
    if (rows.length === 0) lines.push(`  ${none}`);
    for (const row of rows) lines.push(`  ${row.kind === 'entry' ? 'way in' : 'join'}  ${row.id}  ${say(row)}`);
  };
  list(`Slower (p95, at least ${diff.minCount} requests on both sides)`, diff.slower,
    (row) => `${changeSay(row, 'time')} · ${changeSay(row, 'count')}`, 'nothing got slower');
  list('Failing more', diff.failing, (row) => `${changeSay(row, 'errors')} · ${changeSay(row, 'count')}`, 'nothing fails more');
  list(`Newly seen in ${names[1]}`, diff.appeared, (row) => requests(row.count[1]), 'nothing new');
  list(`No longer seen in ${names[1]}`, diff.gone, (row) => `${requests(row.count[0])} in ${names[0]}`, 'nothing went quiet');
  if (diff.tooFew > 0) {
    lines.push('', `${diff.tooFew} seen on both sides had fewer than ${diff.minCount} requests on one: not compared (--min-count)`);
  }
  return lines;
};
