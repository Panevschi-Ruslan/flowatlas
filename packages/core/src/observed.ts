import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * The `observed.json` contract (P65, P85): what `flowatlas observe` wrote
 * beside `graph.db` after laying trace files over the graph. One definition,
 * read the same way by the CLI, the page and the MCP server; the trace formats
 * themselves are read in the CLI only.
 *
 *   {
 *     observedFormatVersion: 2,
 *     spans: n,
 *     joins:     { [joinId]: { count, lastSeen } },
 *     entries:   { [entryId]: { hits, lastSeen } },
 *     symbols:   { [nodeId]: { hits } },
 *     channels:  { [channelId]: { hits } },
 *     unmatched: [{ service?, kind, name, count }],
 *     ambiguous: [{ service?, kind, name, candidates, more?, count }]
 *   }
 *
 * Every count is one span credited to the one place it fits. A span that fits
 * several is credited to none of them and counted under `ambiguous` with the
 * places it could be (version 2; version 1 spread such a span over all of
 * them, so its counts read higher than what ran).
 */
export const OBSERVED_FILE = 'observed.json';
export const OBSERVED_FORMAT_VERSION = 2;
/** The versions a reader takes: version 1 is read as it is, with no `ambiguous`, for one version. */
export const OBSERVED_READ_VERSIONS: readonly number[] = [1, OBSERVED_FORMAT_VERSION];
/** At most this many candidates are named on an ambiguous row; `more` counts the rest. */
export const AMBIGUOUS_CANDIDATES = 5;

export interface Seen {
  count: number;
  lastSeen: string | null;
}

export interface UnmatchedSpan {
  service?: string;
  kind: 'http' | 'client' | 'messaging' | 'code' | 'db' | 'rpc';
  name: string;
  count: number;
}

/**
 * What a span could be and was not credited to. `entry`, `symbol`, `table`
 * and `client` candidates are node ids; `join` candidates are join ids.
 */
export type AmbiguousKind = 'entry' | 'join' | 'client' | 'symbol' | 'table';

export interface AmbiguousSpan {
  service?: string;
  kind: AmbiguousKind;
  /** What the span said: `GET /orders/:value`, `OrdersService.find`, a collection or a destination. */
  name: string;
  /** Sorted, at most `AMBIGUOUS_CANDIDATES`. */
  candidates: string[];
  /** Candidates past the ones named. */
  more?: number;
  count: number;
}

export interface Observed {
  observedFormatVersion: number;
  spans: number;
  /** By join id, see `joinIdOf`. A join is an edge between two places: a call, a hit, an emit, a consume. */
  joins: Record<string, Seen>;
  /** By entry node id. */
  entries: Record<string, { hits: number; lastSeen: string | null }>;
  /** By node id of a method, handler, http call or table a span named. */
  symbols: Record<string, { hits: number }>;
  /** By channel node id. */
  channels: Record<string, { hits: number }>;
  /** Seen at run time, not found in code. */
  unmatched: UnmatchedSpan[];
  /** Seen at run time, fitting more than one place; empty in a version-1 file. */
  ambiguous: AmbiguousSpan[];
}

/** The one grammar a join is named by: `<from> -<type>-> <to>`. */
export const joinIdOf = (from: string, type: string, to: string): string => `${from} -${type}-> ${to}`;

/** A body of counts as the file holds it, stamped with this version. */
export const observedOf = (body: Omit<Observed, 'observedFormatVersion'>): Observed => ({
  observedFormatVersion: OBSERVED_FORMAT_VERSION,
  ...body,
});

/** The file beside a database. */
export const observedPathFor = (dbPath: string): string => join(dirname(dbPath), OBSERVED_FILE);

export type ObservedProblemKind = 'missing' | 'unparseable' | 'invalid' | 'newer-version' | 'unknown-version';

export interface ObservedProblem {
  path: string;
  kind: ObservedProblemKind;
  detail: string;
}

export interface ObservedRead {
  observed?: Observed;
  problem?: ObservedProblem;
}

const seen = z.object({ count: z.number(), lastSeen: z.string().nullable() });
const hits = z.object({ hits: z.number() });
const observedSchema = z.object({
  spans: z.number(),
  joins: z.record(z.string(), seen),
  entries: z.record(z.string(), hits.extend({ lastSeen: z.string().nullable().optional() })),
  symbols: z.record(z.string(), hits),
  channels: z.record(z.string(), hits),
  unmatched: z.array(z.object({ service: z.string().optional(), kind: z.string(), name: z.string(), count: z.number() })),
  ambiguous: z
    .array(
      z.object({
        service: z.string().optional(),
        kind: z.string(),
        name: z.string(),
        candidates: z.array(z.string()),
        more: z.number().optional(),
        count: z.number(),
      }),
    )
    .optional(),
});

const problemOf = (path: string, kind: ObservedProblemKind, detail: string): ObservedRead => ({
  problem: { path, kind, detail },
});

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();

/**
 * The observed file at `path`, or why there is none: `missing`, `unparseable`
 * (not JSON), `invalid` (the wrong shape, with the field), `newer-version` or
 * `unknown-version`. A version-1 file reads with `ambiguous: []`.
 */
export const readObserved = (path: string): ObservedRead => {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return problemOf(path, 'missing', 'no file');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return problemOf(path, 'unparseable', messageOf(error));
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return problemOf(path, 'invalid', 'the file is not an object with observedFormatVersion');
  }
  const version = (parsed as { observedFormatVersion?: unknown }).observedFormatVersion;
  if (typeof version === 'number' && Number.isInteger(version) && version > OBSERVED_FORMAT_VERSION) {
    return problemOf(path, 'newer-version', `format version ${version} was written by a newer flowatlas`);
  }
  if (typeof version !== 'number' || !OBSERVED_READ_VERSIONS.includes(version)) {
    return problemOf(
      path,
      'unknown-version',
      version === undefined ? 'no observedFormatVersion' : `observedFormatVersion ${JSON.stringify(version)} is not one this tool writes`,
    );
  }
  const result = observedSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue === undefined || issue.path.length === 0 ? '(root)' : issue.path.join('.');
    return problemOf(path, 'invalid', `${at}: ${issue?.message ?? 'does not match the format'}`);
  }
  const observed = { ...(parsed as Observed), ambiguous: (result.data.ambiguous ?? []) as AmbiguousSpan[] };
  return { observed };
};

/** One sentence for a surface that reads the file. */
export const describeObservedProblem = (problem: ObservedProblem): string =>
  `${OBSERVED_FILE} at ${problem.path} cannot be read (${problem.detail}), so nothing seen at run time is shown`;
