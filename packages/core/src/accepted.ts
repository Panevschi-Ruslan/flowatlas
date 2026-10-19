import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { compileGlob, isGlob } from './glob.js';

/**
 * Gaps a project has looked at and decided to live with (P72).
 *
 * A baseline accepts a number; this accepts a gap by name, so `doctor` and the
 * checks show only the gaps nobody has looked at yet. Kept beside `graph.db` as
 * `accepted.json`:
 *
 *   {
 *     acceptedFormatVersion: 1,
 *     gaps: [{ reason, service?, file?, note, acceptedAt }]
 *   }
 *
 * An entry with only a reason accepts that reason everywhere; one with a
 * service, everywhere in that service; one with a file, in that file. No line
 * and no symbol: the database keeps neither in a form that survives a
 * reformat, and an accepted gap that comes back after an import was added is
 * worse than none.
 *
 * A **rule** (P76) accepts every gap like one: a reason in a whole service, in
 * every file a glob names (`src/public/**`), or on every route a pattern names
 * (`GET /api/catalog/*`, or `/api/catalog/*` for any method). A rule is matched
 * on what a row says about itself, never on its line, so it holds through a
 * reformat as well as an exact entry does, and it covers a route added under
 * the same prefix tomorrow — which is what accepting "all like this" means.
 *
 * Version 2 added `path`. A reader of version 1 would ignore the field and
 * accept far more than was meant, so the file says it is version 2 and an older
 * reader, which refuses a version it does not know, accepts nothing instead.
 *
 * A file that cannot be read is said, never taken for an empty one (P80): every
 * reader reports the problem and accepts nothing, and `flowatlas accept` refuses
 * to write over it, because a typo or a merge marker read as "nothing accepted"
 * and then saved with one entry used to wipe every other entry and rule.
 */
export const ACCEPTED_FILE = 'accepted.json';
export const ACCEPTED_FORMAT_VERSION = 2;

export interface AcceptedGap {
  reason: string;
  service?: string;
  /** Repo-relative file, or a glob over one in the grammar of `glob.ts`. */
  file?: string;
  /**
   * A route pattern, matched against a route row's `METHOD /path`: `GET
   * /api/public/*`, or `/api/public/*` for every method; `*` is any run of
   * characters.
   */
  path?: string;
  /** Why it was accepted, in a person's words. */
  note: string;
  /** ISO-8601. */
  acceptedAt: string;
}

export interface AcceptedFile {
  acceptedFormatVersion: number;
  gaps: AcceptedGap[];
}

/** What a gap is matched on, whichever way it was read. */
export interface GapLike {
  reason: string;
  service?: string | null;
  file?: string | null;
  /** On an accepted entry: the route pattern it names. */
  path?: string | null;
  /** On a row: what it is about — for a route finding, `METHOD /path`. */
  symbol?: string | null;
  /** On a row read back from the database, where the symbol is kept as `node`. */
  node?: string | null;
}

const acceptedSchema = z.object({
  // Version 1 is version 2 without `path`, so both read the same way.
  acceptedFormatVersion: z.union([z.literal(1), z.literal(ACCEPTED_FORMAT_VERSION)]),
  gaps: z.array(
    z.object({
      reason: z.string().min(1),
      service: z.string().optional(),
      file: z.string().optional(),
      path: z.string().min(1).optional(),
      note: z.string(),
      acceptedAt: z.string(),
    }),
  ),
});

const GAP_PREFIX = 'gap:';

/** The id a gap answers to everywhere: `gap:<service>|<file>|<reason>`. */
export const gapIdOf = (gap: GapLike): string =>
  `${GAP_PREFIX}${gap.service ?? ''}|${gap.file ?? ''}|${gap.reason}`;

export const isGapId = (value: string): boolean => value.startsWith(GAP_PREFIX);

/** A gap id read back into what it names; empty parts name nothing. */
export const parseGapId = (id: string): GapLike | undefined => {
  if (!isGapId(id)) return undefined;
  const parts = id.slice(GAP_PREFIX.length).split('|');
  if (parts.length !== 3 || parts[2] === '') return undefined;
  const [service, file, reason] = parts as [string, string, string];
  return {
    reason,
    ...(service === '' ? {} : { service }),
    ...(file === '' ? {} : { file }),
  };
};

const fits = (wanted: string | undefined, actual: string | null | undefined): boolean =>
  wanted === undefined || wanted === (actual ?? '');

const escape = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a file pattern is a glob rather than one path.
 *
 * @deprecated Use `isGlob` from the glob grammar, which counts `?` too. Kept
 * for one version so callers outside this repository keep compiling.
 */
export const isFileGlob = (pattern: string): boolean => isGlob(pattern);

/** A route pattern compiled once: a test on a route's method and path. */
export interface RoutePattern {
  readonly pattern: string;
  test(method: string, path: string): boolean;
}

/**
 * `METHOD /path` with `*` for any run of characters, `/` included, compiled once.
 *
 * Not the glob grammar on purpose: a route is not a path on disk, and
 * `GET /api/*` has always covered `/api/a/b`. A pattern without a path covers
 * nothing.
 */
export const compileRoutePattern = (pattern: string): RoutePattern => {
  const [wantedMethod, ...rest] = pattern.trim().split(/\s+/);
  const wantedPath = rest.join(' ');
  if (wantedMethod === undefined || wantedPath === '') return { pattern, test: () => false };
  const method = wantedMethod.toUpperCase();
  const expression = new RegExp(`^${wantedPath.split('*').map(escape).join('.*')}$`);
  return {
    pattern,
    test: (actualMethod, path) => (method === '*' || method === actualMethod.toUpperCase()) && expression.test(path),
  };
};

/**
 * Whether `METHOD /path` with `*` for any run of characters covers a route.
 *
 * One question asked by three readers of the same configured patterns: the
 * route audit (`doctor.publicRoutes`), `dead`, which must not report a route
 * the configuration has already called public, and an accepted rule.
 */
export const matchesRoutePattern = (pattern: string, method: string, path: string): boolean =>
  compileRoutePattern(pattern).test(method, path);

/** A route pattern with its method said: `/a/*` is `* /a/*`. */
export const routePatternOf = (pattern: string): string => {
  const trimmed = pattern.trim();
  return trimmed.startsWith('/') ? `* ${trimmed}` : trimmed;
};

/** The route a row is about, when its symbol is one: `GET /orders/:param`. */
export const routeOfSymbol = (symbol: string | null | undefined): { method: string; path: string } | undefined => {
  const match = /^([A-Za-z]+|\*) (\/\S*)$/.exec(symbol ?? '');
  return match === null ? undefined : { method: match[1] as string, path: match[2] as string };
};

/** A test on one field of a gap, compiled once per entry. */
type FieldTest = (gap: GapLike) => boolean;

const ANY: FieldTest = () => true;

const fileTest = (wanted: string | null | undefined): FieldTest => {
  if (wanted == null) return ANY;
  if (!isGlob(wanted)) return (gap) => fits(wanted, gap.file);
  const glob = compileGlob(wanted);
  return (gap) => gap.file != null && glob.test(gap.file);
};

const pathTest = (wanted: string | null | undefined): FieldTest => {
  if (wanted == null) return ANY;
  const route = compileRoutePattern(routePatternOf(wanted));
  return (gap) => {
    const at = routeOfSymbol(gap.symbol ?? gap.node);
    return at !== undefined && route.test(at.method, at.path);
  };
};

/** One entry with its file glob and route pattern compiled. */
const compileEntry = (entry: GapLike): FieldTest => {
  const service = entry.service ?? undefined;
  const file = fileTest(entry.file);
  const path = pathTest(entry.path);
  return (gap) => entry.reason === gap.reason && fits(service, gap.service) && file(gap) && path(gap);
};

/** How the rows of one surface fall, once accepted entries are matched against them. */
export interface AcceptedSplit<T> {
  /** Rows no entry accepts, order kept. */
  fresh: T[];
  /** Rows an entry accepts, order kept. */
  accepted: T[];
  /** For each row in the order given, the entry that accepted it, or undefined. */
  byEntry: Array<AcceptedGap | undefined>;
}

/**
 * Accepted entries compiled once, for matching many rows.
 *
 * Every surface that hides accepted rows used to rebuild each entry's glob and
 * route expression for every row it asked about, twice on the page; compiled,
 * one set answers a whole surface.
 */
export interface AcceptedRules {
  readonly entries: readonly AcceptedGap[];
  /** The first entry that covers a gap, when one does. */
  match(gap: GapLike): AcceptedGap | undefined;
  /**
   * Splits rows into the new ones and the accepted ones, order kept.
   *
   * `matchedAs` is what a row is matched on, when that is more than the row
   * carries itself: a row read back without the route it is about.
   */
  split<T extends GapLike>(rows: readonly T[], matchedAs?: (row: T) => GapLike): AcceptedSplit<T>;
}

export const compileAccepted = (entries: readonly AcceptedGap[]): AcceptedRules => {
  const tests = entries.map((entry) => [entry, compileEntry(entry)] as const);
  const match = (gap: GapLike): AcceptedGap | undefined => tests.find(([, test]) => test(gap))?.[0];
  return {
    entries,
    match,
    split: <T extends GapLike>(rows: readonly T[], matchedAs: (row: T) => GapLike = (row) => row) => {
      const out: AcceptedSplit<T> = { fresh: [], accepted: [], byEntry: [] };
      for (const row of rows) {
        const entry = match(matchedAs(row));
        out.byEntry.push(entry);
        (entry === undefined ? out.fresh : out.accepted).push(row);
      }
      return out;
    },
  };
};

/** Whether one accepted entry covers one gap. */
export const covers = (entry: GapLike, gap: GapLike): boolean => compileEntry(entry)(gap);

/**
 * Whether an entry accepts every gap like one rather than one gap in one place.
 *
 * One place is a reason in one file, which is what a gap id names. Anything
 * wider — a reason with no file, a file glob, a route pattern — is a rule, and
 * the page says which rule took a row, because a rule goes on taking rows
 * nobody has looked at.
 */
export const isRule = (entry: GapLike): boolean =>
  entry.path != null || entry.file == null || isGlob(entry.file);

/** A rule in a line: `route-unguarded · service catalog · path GET /public/*`. */
export const describeAccepted = (entry: GapLike): string => {
  const parts = [entry.reason];
  if (entry.service != null) parts.push(`service ${entry.service}`);
  if (entry.file != null) parts.push(`file ${entry.file}`);
  if (entry.path != null) parts.push(`path ${entry.path}`);
  if (parts.length === 1) parts.push('everywhere');
  return parts.join(' · ');
};

/**
 * The entry that covers a gap, when one does.
 *
 * @deprecated Compiles every entry on every call; use `compileAccepted(...).match`.
 * Kept for one version.
 */
export const acceptedFor = (
  accepted: readonly AcceptedGap[],
  gap: GapLike,
): AcceptedGap | undefined => compileAccepted(accepted).match(gap);

/**
 * Splits gaps into the new ones and the accepted ones, order kept.
 *
 * @deprecated Use `compileAccepted(...).split`, or `acceptedSplitOf` in the
 * linker, which also demotes answered rows and matches a row on its route.
 * Kept for one version.
 */
export const splitAccepted = <T extends GapLike>(
  accepted: readonly AcceptedGap[],
  gaps: readonly T[],
  matchedAs: (gap: T) => GapLike = (gap) => gap,
): { fresh: T[]; accepted: T[] } => {
  const { fresh, accepted: known } = compileAccepted(accepted).split(gaps, matchedAs);
  return { fresh, accepted: known };
};

export const acceptedPathFor = (dbPath: string): string => join(dirname(dbPath), ACCEPTED_FILE);

/** Why an `accepted.json` that is there could not be read. */
export type AcceptedProblemKind = 'unparseable' | 'invalid' | 'newer-version' | 'unknown-version';

export interface AcceptedProblem {
  /** The file, as it was looked for. */
  path: string;
  kind: AcceptedProblemKind;
  /** What was wrong, in a few words: the parser's message, the field, the version. */
  detail: string;
}

/** The accepted gaps beside a database, and why there are none when the file could not be read. */
export interface AcceptedRead {
  gaps: AcceptedGap[];
  /** Absent when the file read, and when there is no file. */
  problem?: AcceptedProblem;
}

const problemOf = (path: string, kind: AcceptedProblemKind, detail: string): AcceptedRead => ({
  gaps: [],
  problem: { path, kind, detail },
});

/** The parser's message on one line: it quotes the text it stopped at, line breaks and all. */
const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();

/**
 * The accepted gaps beside a database, with what was wrong when the file is
 * there and cannot be read.
 *
 * A missing file is no problem: nothing has been accepted yet. Anything else
 * that is not a file this version reads is one, and says which:
 * `unparseable` (not JSON — a merge marker, a truncated write), `invalid` (JSON
 * of the wrong shape, with the field), `newer-version` (a format number above
 * this one's, written by a newer flowatlas) or `unknown-version` (no format
 * number this tool ever wrote).
 */
export const readAccepted = (dbPath: string): AcceptedRead => {
  const path = acceptedPathFor(dbPath);
  if (!existsSync(path)) return { gaps: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return problemOf(path, 'unparseable', messageOf(error));
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return problemOf(path, 'invalid', 'the file is not an object with acceptedFormatVersion and gaps');
  }
  const version = (parsed as { acceptedFormatVersion?: unknown }).acceptedFormatVersion;
  if (typeof version === 'number' && Number.isInteger(version) && version > ACCEPTED_FORMAT_VERSION) {
    return problemOf(
      path,
      'newer-version',
      `format version ${version} was written by a newer flowatlas, which this one (format ${ACCEPTED_FORMAT_VERSION}) cannot read; upgrade to change it`,
    );
  }
  if (version !== 1 && version !== ACCEPTED_FORMAT_VERSION) {
    return problemOf(
      path,
      'unknown-version',
      version === undefined
        ? 'no acceptedFormatVersion'
        : `acceptedFormatVersion ${JSON.stringify(version)} is not one this tool writes`,
    );
  }
  const result = acceptedSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue === undefined || issue.path.length === 0 ? '(root)' : issue.path.join('.');
    return problemOf(path, 'invalid', `${at}: ${issue?.message ?? 'does not match the format'}`);
  }
  return { gaps: result.data.gaps as AcceptedGap[] };
};

/** One sentence for a surface that reads the file: what is wrong, and what it means. */
export const describeAcceptedProblem = (problem: AcceptedProblem): string =>
  `${ACCEPTED_FILE} at ${problem.path} cannot be read (${problem.detail}), so nothing in it is accepted`;

/**
 * The accepted gaps beside a database; none when there is no file or it cannot be read.
 *
 * @deprecated Says nothing about a file that cannot be read, which is how a bad
 * file used to be read as empty and then written over. Use `readAccepted`.
 * Kept for one version.
 */
export const loadAccepted = (dbPath: string): AcceptedGap[] => readAccepted(dbPath).gaps;

/**
 * What one entry is about, for telling two entries apart: its gap id, and the
 * route pattern when it has one. Two rules over one service that name two
 * prefixes are two entries, not one entry written twice.
 */
export const acceptedKeyOf = (entry: GapLike): string =>
  entry.path == null ? gapIdOf(entry) : `${gapIdOf(entry)}|${entry.path}`;

const order = (a: AcceptedGap, b: AcceptedGap): number => {
  const left = acceptedKeyOf(a);
  const right = acceptedKeyOf(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

let written = 0;

/**
 * Writes the list sorted, so two people accepting the same gaps write the same file.
 *
 * Through a temporary beside it, renamed into place, as the build writes its
 * cache: a write cut short leaves the old file whole rather than half a file
 * the next read would call unparseable. The temporary carries the process, so
 * two writers never rename each other's.
 */
export const saveAccepted = (dbPath: string, gaps: readonly AcceptedGap[]): string => {
  const path = acceptedPathFor(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  const file: AcceptedFile = { acceptedFormatVersion: ACCEPTED_FORMAT_VERSION, gaps: [...gaps].sort(order) };
  const temporary = `${path}.${process.pid}.${(written += 1)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return path;
};

const sameTarget = (a: GapLike, b: GapLike): boolean => acceptedKeyOf(a) === acceptedKeyOf(b);

/** The list with one entry added, or its note replaced when it was there already. */
export const withAccepted = (gaps: readonly AcceptedGap[], entry: AcceptedGap): AcceptedGap[] => [
  ...gaps.filter((gap) => !sameTarget(gap, entry)),
  entry,
];

/** The list without one entry. */
export const withoutAccepted = (gaps: readonly AcceptedGap[], target: GapLike): AcceptedGap[] =>
  gaps.filter((gap) => !sameTarget(gap, target));
