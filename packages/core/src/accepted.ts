import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

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
 */
export const ACCEPTED_FILE = 'accepted.json';
export const ACCEPTED_FORMAT_VERSION = 2;

export interface AcceptedGap {
  reason: string;
  service?: string;
  /** Repo-relative file, or a glob over one: `*` within a segment, `**` across them. */
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

/** Whether a file pattern is a glob rather than one path. */
export const isFileGlob = (pattern: string): boolean => pattern.includes('*');

/** `*` within one segment, `**` across any number of them, as a shell would. */
const globExpression = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('**')
      .map((part) => part.split('*').map(escape).join('[^/]*'))
      .join('.*')}$`,
  );

const fileFits = (wanted: string | undefined, actual: string | null | undefined): boolean => {
  if (wanted === undefined) return true;
  if (!isFileGlob(wanted)) return fits(wanted, actual);
  return actual != null && globExpression(wanted).test(actual);
};

/**
 * Whether `METHOD /path` with `*` for any run of characters covers a route.
 *
 * One question asked by three readers of the same configured patterns: the
 * route audit (`doctor.publicRoutes`), `dead`, which must not report a route
 * the configuration has already called public, and an accepted rule.
 */
export const matchesRoutePattern = (pattern: string, method: string, path: string): boolean => {
  const [wantedMethod, ...rest] = pattern.trim().split(/\s+/);
  const wantedPath = rest.join(' ');
  if (wantedMethod === undefined || wantedPath === '') return false;
  if (wantedMethod !== '*' && wantedMethod.toUpperCase() !== method.toUpperCase()) return false;
  const expression = new RegExp(`^${wantedPath.split('*').map(escape).join('.*')}$`);
  return expression.test(path);
};

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

const pathFits = (wanted: string | null | undefined, gap: GapLike): boolean => {
  if (wanted == null) return true;
  const route = routeOfSymbol(gap.symbol ?? gap.node);
  return route !== undefined && matchesRoutePattern(routePatternOf(wanted), route.method, route.path);
};

/** Whether one accepted entry covers one gap. */
export const covers = (entry: GapLike, gap: GapLike): boolean =>
  entry.reason === gap.reason &&
  fits(entry.service ?? undefined, gap.service) &&
  fileFits(entry.file ?? undefined, gap.file) &&
  pathFits(entry.path, gap);

/**
 * Whether an entry accepts every gap like one rather than one gap in one place.
 *
 * One place is a reason in one file, which is what a gap id names. Anything
 * wider — a reason with no file, a file glob, a route pattern — is a rule, and
 * the page says which rule took a row, because a rule goes on taking rows
 * nobody has looked at.
 */
export const isRule = (entry: GapLike): boolean =>
  entry.path != null || entry.file == null || isFileGlob(entry.file);

/** A rule in a line: `route-unguarded · service catalog · path GET /public/*`. */
export const describeAccepted = (entry: GapLike): string => {
  const parts = [entry.reason];
  if (entry.service != null) parts.push(`service ${entry.service}`);
  if (entry.file != null) parts.push(`file ${entry.file}`);
  if (entry.path != null) parts.push(`path ${entry.path}`);
  if (parts.length === 1) parts.push('everywhere');
  return parts.join(' · ');
};

/** The entry that covers a gap, when one does. */
export const acceptedFor = (
  accepted: readonly AcceptedGap[],
  gap: GapLike,
): AcceptedGap | undefined => accepted.find((entry) => covers(entry, gap));

/**
 * Splits gaps into the new ones and the accepted ones, order kept.
 *
 * `matchedAs` is what a gap is matched on, when that is more than the gap
 * carries itself: a row read back without the route it is about.
 */
export const splitAccepted = <T extends GapLike>(
  accepted: readonly AcceptedGap[],
  gaps: readonly T[],
  matchedAs: (gap: T) => GapLike = (gap) => gap,
): { fresh: T[]; accepted: T[] } => {
  const fresh: T[] = [];
  const known: T[] = [];
  for (const gap of gaps) (acceptedFor(accepted, matchedAs(gap)) === undefined ? fresh : known).push(gap);
  return { fresh, accepted: known };
};

export const acceptedPathFor = (dbPath: string): string => join(dirname(dbPath), ACCEPTED_FILE);

/** The accepted gaps beside a database; none when there is no file or it cannot be read. */
export const loadAccepted = (dbPath: string): AcceptedGap[] => {
  const path = acceptedPathFor(dbPath);
  if (!existsSync(path)) return [];
  try {
    return acceptedSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).gaps as AcceptedGap[];
  } catch {
    return [];
  }
};

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

/** Writes the list sorted, so two people accepting the same gaps write the same file. */
export const saveAccepted = (dbPath: string, gaps: readonly AcceptedGap[]): string => {
  const path = acceptedPathFor(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  const file: AcceptedFile = { acceptedFormatVersion: ACCEPTED_FORMAT_VERSION, gaps: [...gaps].sort(order) };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
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
