/**
 * What the project has already agreed to live with.
 *
 * A tool that fails a build the first time it is run in a project with history
 * is a tool that gets switched off that afternoon. The baseline is the number
 * that was true when somebody looked, committed beside the configuration, and
 * `--strict` asks one question of it: did the count of things a person could
 * act on go up.
 *
 * Two decisions make that question answerable. A key does not carry a line, so
 * reformatting a file cannot grow the baseline; and only actionable rows are
 * counted, because an informational row records a limit of static reading that
 * no edit to the repository would remove — failing a build on one is asking for
 * the impossible.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { userInfo } from 'node:os';
import type { Unresolved } from '@flowatlas/core';
import { z } from 'zod';
import { BASELINE_FORMAT_VERSION, type BaselineDelta } from './schema.js';

export { BASELINE_FORMAT_VERSION };

/** One key, and how many places it stands for. */
export interface KeyCount {
  key: string;
  count: number;
}

export interface UnresolvedSnapshot {
  /** Places a person can act on: what `--strict` compares. */
  total: number;
  /** Actionable places, by reason. */
  byReason: Record<string, number>;
  /** Actionable places, by service. */
  byService: Record<string, number>;
  /** Every actionable key with its count, in key order. */
  keys: KeyCount[];
  /**
   * The informational side, recorded and never compared.
   *
   * Kept so a reader can see it move — 731 places folded into 17 rows is a
   * number worth watching — without a build ever failing on it.
   */
  info: { rows: number; sites: number };
}

export interface Baseline {
  baselineFormatVersion: number;
  schemaVersion: number;
  flowatlasVersion: string;
  /** ISO-8601. */
  acceptedAt: string;
  /** Git identity, or the account name; informational only. */
  acceptedBy: string;
  graph: {
    builtAt: string;
    services: Record<string, { sha: string | null }>;
  };
  unresolved: UnresolvedSnapshot;
  /** Errors are never baselined; a marker that lies is never acceptable. */
  markers: { warnings: number };
  /** The same for contracts: recorded for a reader, never compared. */
  contracts: { warnings: number; infos: number; ignored: number };
}

const counts = z.record(z.string(), z.number().int().nonnegative());

export const baselineSchema = z.object({
  baselineFormatVersion: z.number().int().positive(),
  schemaVersion: z.number().int().nonnegative(),
  flowatlasVersion: z.string(),
  acceptedAt: z.string(),
  acceptedBy: z.string(),
  graph: z.object({
    builtAt: z.string(),
    services: z.record(z.string(), z.object({ sha: z.string().nullable() })),
  }),
  unresolved: z.object({
    total: z.number().int().nonnegative(),
    byReason: counts,
    byService: counts,
    keys: z.array(z.object({ key: z.string(), count: z.number().int().positive() })),
    info: z.object({
      rows: z.number().int().nonnegative(),
      sites: z.number().int().nonnegative(),
    }),
  }),
  markers: z.object({ warnings: z.number().int().nonnegative() }),
  contracts: z.object({
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
  }),
});

/**
 * The symbol as a key can hold it: one line, and not an essay.
 *
 * A row names the expression it gave up on as it is written, which can be four
 * lines of a call. Collapsing the whitespace makes the key survive a reformat
 * of that very expression — the thing D3 is for — and keeps the baseline a file
 * a person can read a line at a time.
 */
const flatten = (symbol: string): string => {
  const flat = symbol.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
};

/**
 * What identifies a row across two builds.
 *
 * No line: a row that moved down a file when an import was added is the same
 * row, and a baseline that disagreed would fail every reformat. The symbol is
 * in, because two methods in one file failing for the same reason are two
 * things to fix and one of them being fixed should show.
 */
export const unresolvedKey = (row: Unresolved, service?: string): string =>
  `${row.service ?? service ?? ''}|${row.file}|${row.symbol === undefined ? '' : flatten(row.symbol)}|${row.reason}`;

/** Whether a row names something a person could change. */
export const isActionable = (row: Unresolved): boolean => (row.level ?? 'action') === 'action';

const sitesOf = (row: Unresolved): number => row.sites ?? 1;

const sorted = (counted: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...counted.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

/**
 * The project as it stands, counted the way the baseline counts it.
 *
 * `ignoreReasons` takes a reason out of the totals and out of the keys, so a
 * project can put its known noise aside without hiding it: the rows are still
 * printed, and the reasons that were set aside are named in the report.
 */
export const snapshotOf = (
  rows: readonly Unresolved[],
  options: { ignoreReasons?: readonly string[] } = {},
): UnresolvedSnapshot => {
  const ignored = new Set(options.ignoreReasons ?? []);
  const byReason = new Map<string, number>();
  const byService = new Map<string, number>();
  const keys = new Map<string, number>();
  let total = 0;
  let infoRows = 0;
  let infoSites = 0;

  for (const row of rows) {
    const sites = sitesOf(row);
    if (!isActionable(row)) {
      infoRows += 1;
      infoSites += sites;
      continue;
    }
    if (ignored.has(row.reason)) continue;
    const service = row.service ?? '';
    total += sites;
    byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + sites);
    byService.set(service, (byService.get(service) ?? 0) + sites);
    const key = unresolvedKey(row);
    keys.set(key, (keys.get(key) ?? 0) + sites);
  }

  return {
    total,
    byReason: sorted(byReason),
    byService: sorted(byService),
    keys: [...keys.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, count]) => ({ key, count })),
    info: { rows: infoRows, sites: infoSites },
  };
};

/** Why a baseline could not be used, when it could not. */
export type BaselineProblem = { status: 'missing' | 'invalid'; note: string };

export type BaselineRead = { baseline: Baseline } | BaselineProblem;

export const isProblem = (read: BaselineRead): read is BaselineProblem => 'status' in read;

/**
 * Reads the accepted numbers, or says exactly why it could not.
 *
 * A baseline written by a newer tool is refused rather than guessed at: the
 * fields it holds may not mean what this version thinks they mean, and a check
 * that silently reinterprets its own history is worse than one that stops.
 */
export const readBaseline = (path: string): BaselineRead => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { status: 'missing', note: `no baseline at ${path}; run flowatlas doctor --accept to write one` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      status: 'invalid',
      note: `${path} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); regenerate it with flowatlas doctor --accept`,
    };
  }
  const version = (parsed as { baselineFormatVersion?: unknown }).baselineFormatVersion;
  if (typeof version === 'number' && version > BASELINE_FORMAT_VERSION) {
    return {
      status: 'invalid',
      note: `${path} is version ${version} and this tool understands ${BASELINE_FORMAT_VERSION}; regenerate it with --accept (an older CLI cannot read a newer baseline)`,
    };
  }
  const result = baselineSchema.safeParse(parsed);
  if (!result.success) {
    const [first] = result.error.issues;
    const where = first === undefined ? '(root)' : first.path.join('.') || '(root)';
    return {
      status: 'invalid',
      note: `${path} does not match the baseline format at ${where}: ${first?.message ?? 'unknown'}; regenerate it with flowatlas doctor --accept`,
    };
  }
  return { baseline: result.data as Baseline };
};

/** Writes the baseline, creating the directory if it is not there. */
export const writeBaseline = (path: string, baseline: Baseline): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
};

/**
 * Who accepted it: informational, and never worth failing over.
 *
 * Git first, because a baseline is a commit and the person who made it is the
 * person the next reader will ask about it.
 */
export const acceptedBy = (cwd: string = process.cwd()): string => {
  try {
    const email = execFileSync('git', ['config', 'user.email'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (email !== '') return email;
  } catch {
    // Not a repository, or git is not installed. The account name will do.
  }
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
};

const deltaRows = (
  current: Readonly<Record<string, number>>,
  before: Readonly<Record<string, number>>,
): BaselineDelta['byReason'] =>
  [...new Set([...Object.keys(current), ...Object.keys(before)])]
    .sort()
    .map((reason) => ({
      reason,
      baseline: before[reason] ?? 0,
      current: current[reason] ?? 0,
      delta: (current[reason] ?? 0) - (before[reason] ?? 0),
    }))
    .filter((row) => row.delta !== 0 || row.current !== 0);

/**
 * The project against what was accepted.
 *
 * Only the total decides: per-reason and per-key movement is reported because a
 * reader wants to see it, and does not fail on its own because a refactor that
 * moves three rows from one reason to another has broken nothing. Equal totals
 * with different keys is `ok`, and the two lists say what moved.
 */
export const compareBaseline = (
  current: UnresolvedSnapshot,
  read: BaselineRead | undefined,
  options: { schemaVersion?: number } = {},
): BaselineDelta => {
  if (read === undefined) {
    return {
      status: 'skipped',
      note: 'the growth check was not run',
      total: { baseline: 0, current: current.total, delta: 0 },
      byReason: [],
      newKeys: [],
      goneKeys: [],
    };
  }
  if (isProblem(read)) {
    return {
      status: read.status,
      note: read.note,
      total: { baseline: 0, current: current.total, delta: current.total },
      byReason: deltaRows(current.byReason, {}),
      newKeys: current.keys.map((entry) => entry.key),
      goneKeys: [],
    };
  }

  const before = read.baseline.unresolved;
  const nowKeys = new Set(current.keys.map((entry) => entry.key));
  const thenKeys = new Set(before.keys.map((entry) => entry.key));
  const delta = current.total - before.total;

  // A baseline taken under an older graph schema is still compared: what it
  // holds is a count of places, and a place is a place whatever version wrote
  // it down. Worth saying, since a schema change can move the count on its own.
  const stale =
    options.schemaVersion !== undefined && options.schemaVersion !== read.baseline.schemaVersion
      ? `accepted against graph schema ${read.baseline.schemaVersion}, and this graph is ${options.schemaVersion}; the counts are still comparable, but a schema change can move them on its own`
      : null;

  return {
    status: delta > 0 ? 'grew' : 'ok',
    note: stale,
    total: { baseline: before.total, current: current.total, delta },
    byReason: deltaRows(current.byReason, before.byReason),
    newKeys: [...nowKeys].filter((key) => !thenKeys.has(key)).sort(),
    goneKeys: [...thenKeys].filter((key) => !nowKeys.has(key)).sort(),
  };
};
