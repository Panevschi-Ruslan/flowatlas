import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { emptyAgg, mergeAgg, summarise, type Agg } from './observed-stats.js';

/**
 * The `observed.json` contract (P65, P85, P105): what `flowatlas observe`
 * wrote beside `graph.db` after laying trace files over the graph. One
 * definition, read the same way by the CLI, the page and the MCP server; the
 * trace formats themselves are read in the CLI only.
 *
 *   {
 *     observedFormatVersion: 3,
 *     spans: n,
 *     privacy:   { kept, dropped, droppedAttributes, samples: { kept, perEntry, spansPerSample } },
 *     window:    { since?, from, to },
 *     sources:   [{ sha256, format, spans, readAt }],
 *     joins:     { [joinId]:    { count, lastSeen, ...figures, measuredAt? } },
 *     entries:   { [entryId]:   { hits, lastSeen, ...figures } },
 *     symbols:   { [nodeId]:    { hits, lastSeen, ...figures } },
 *     channels:  { [channelId]: { hits, lastSeen, ...figures } },
 *     unmatched: [{ service?, kind, name, count, ...figures }],
 *     ambiguous: [{ service?, kind, name, candidates, more?, count }],
 *     samples:   { [entryId]: { slow: Sample[], failing: Sample[] } },
 *     buckets:   [{ hour, spans, joins, entries, symbols, channels, unmatched, ambiguous }]
 *   }
 *
 * `figures` are `summarise`'s (`observed-stats.ts`): `firstSeen`, `p50`,
 * `p95`, `max` (milliseconds), `statuses`, `errors`, `errorRate`. The top
 * level is the roll-up of `buckets`, one per hour of span start time, under
 * the names version 1 used, so a version-1 reader's field still means the
 * same thing. The window is the list of buckets: a later run adds to it, and
 * `--since` cuts it, without the traces at hand.
 *
 * Every count is one span credited to the one place it fits. A span that fits
 * several is credited to none of them and counted under `ambiguous` (version
 * 2; version 1 spread such a span over all of them).
 *
 * Trace ids appear in `samples` only, at most `SAMPLES_PER_ENTRY` slow and as
 * many failing per entry, each a tree of at most `SPANS_PER_SAMPLE` spans with
 * no span or parent id. Without samples the file holds no id at all.
 */
export const OBSERVED_FILE = 'observed.json';
export const OBSERVED_FORMAT_VERSION = 3;
/** The versions a reader takes: 1 and 2 are read as one bucket of counts with no timings (P105 D7). */
export const OBSERVED_READ_VERSIONS: readonly number[] = [1, 2, OBSERVED_FORMAT_VERSION];
/** At most this many candidates are named on an ambiguous row; `more` counts the rest. */
export const AMBIGUOUS_CANDIDATES = 5;
/** Slow and failing samples kept per entry, each. */
export const SAMPLES_PER_ENTRY = 3;
/** Spans one sample's tree holds at most; `cut` counts the rest. */
export const SPANS_PER_SAMPLE = 200;
export const HOUR_MS = 3_600_000;

/**
 * What a reader keeps of a span, field by field (P105 §4): the allow-list
 * every reader ends with (`keepAllowed` in the CLI) and the file's `privacy`
 * block names. A path keeps its shape, with every value-like segment masked.
 */
export const OBSERVED_KEPT = [
  'traceId',
  'spanId',
  'parentId',
  'service',
  'kind',
  'method',
  'route',
  'path',
  'destination',
  'symbol',
  'collection',
  'rpc',
  'at',
  'status',
  'durationMs',
  'error',
] as const;

/**
 * What no reader copies, by category: fixed text, so the file says what was
 * dropped without holding a dropped value or a dropped key's name.
 */
export const OBSERVED_DROPPED: readonly string[] = [
  'request and response headers',
  'cookies',
  'query strings and fragments',
  'hosts and ports',
  'values in a path (masked as :value)',
  'request and response bodies',
  'database statements and queries',
  'end-user attributes',
  'span names',
  'span events and exception text',
  'status messages',
  'every attribute not on the kept list',
  '@nestjs/observe user, request, tags, logs, objectives, runtime and custom data',
];

export type UnmatchedKind = 'http' | 'client' | 'messaging' | 'code' | 'db' | 'rpc';

/** The figures `summarise` gives, beside a roll-up row's count. Optional: a version-1 or 2 file has none. */
export interface ObservedFigures {
  firstSeen?: string | null;
  p50?: number;
  p95?: number;
  max?: number;
  statuses?: Record<string, number>;
  errors?: number;
  errorRate?: number;
}

/** Which side of a join its timing was taken on (P105 D5): the caller's span when one was seen. */
export type MeasuredAt = 'caller' | 'callee';

export interface Seen extends ObservedFigures {
  count: number;
  lastSeen: string | null;
  measuredAt?: MeasuredAt;
}

export interface HitSeen extends ObservedFigures {
  hits: number;
  lastSeen?: string | null;
}

export interface UnmatchedSpan extends ObservedFigures {
  service?: string;
  kind: UnmatchedKind;
  name: string;
  count: number;
  lastSeen?: string | null;
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

export interface ObservedPrivacy {
  /** `OBSERVED_KEPT`. */
  kept: string[];
  /** `OBSERVED_DROPPED`. */
  dropped: string[];
  /** Attribute keys seen and not read, counted each time one was seen. Never a name. */
  droppedAttributes: number;
  samples: { kept: boolean; perEntry: number; spansPerSample: number };
}

export interface ObservedWindow {
  /** What `--since` said last (`7d`); later runs keep cutting the same way until `--since all`. */
  since?: string;
  /** Start of the first hour held, or null when nothing is. */
  from: string | null;
  /** End of the last hour held. */
  to: string | null;
}

/** One file read: known by its hash, never by its path (P105 D4). */
export interface ObservedSource {
  sha256: string;
  format: string;
  spans: number;
  readAt: string;
}

/** A join's figures, and how many of its spans were measured on the callee's side. */
export interface JoinAgg extends Agg {
  callee?: number;
}

export interface UnmatchedAgg extends Agg {
  service?: string;
  kind: UnmatchedKind;
  name: string;
}

/** One hour of span start time. */
export interface ObservedBucket {
  /** ISO time the hour starts. */
  hour: string;
  spans: number;
  joins: Record<string, JoinAgg>;
  entries: Record<string, Agg>;
  symbols: Record<string, Agg>;
  channels: Record<string, Agg>;
  unmatched: UnmatchedAgg[];
  ambiguous: AmbiguousSpan[];
}

/**
 * One span of a sample, and the spans under it. `id` is the graph node it was
 * credited to, when one; `label` what the span said, from kept fields only.
 */
export interface TraceTree {
  id?: string;
  label: string;
  service?: string;
  kind: string;
  ms?: number;
  status?: number;
  error?: true;
  children?: TraceTree[];
}

export interface ObservedSample {
  traceId: string;
  /** When the entry's span started (its hour when the span did not say). */
  at: string;
  ms?: number;
  status?: number;
  error?: true;
  /** Spans in `tree`. */
  spans: number;
  /** Spans under the entry left out past `SPANS_PER_SAMPLE`. */
  cut?: number;
  tree: TraceTree;
}

export interface EntrySamples {
  slow: ObservedSample[];
  failing: ObservedSample[];
}

export interface Observed {
  /** The version the file was written at; 1 or 2 for a file read and upgraded in memory. */
  observedFormatVersion: number;
  spans: number;
  privacy: ObservedPrivacy;
  window: ObservedWindow;
  sources: ObservedSource[];
  /** By join id, see `joinIdOf`. A join is an edge between two places: a call, a hit, an emit, a consume. */
  joins: Record<string, Seen>;
  /** By entry node id. */
  entries: Record<string, HitSeen & { lastSeen: string | null }>;
  /** By node id of a method, handler, http call or table a span named. */
  symbols: Record<string, HitSeen>;
  /** By channel node id. */
  channels: Record<string, HitSeen>;
  /** Seen at run time, not found in code. */
  unmatched: UnmatchedSpan[];
  /** Seen at run time, fitting more than one place; empty in a version-1 file. */
  ambiguous: AmbiguousSpan[];
  /** By entry id; the only place a trace id is written. */
  samples: Record<string, EntrySamples>;
  buckets: ObservedBucket[];
}

/** Edge types that join two places, the ones `observed` counts joins on. */
export const JOIN_EDGE_TYPES: readonly string[] = ['http_calls', 'hits', 'emits', 'consumes', 'triggers'];

/** The one grammar a join is named by: `<from> -<type>-> <to>`. */
export const joinIdOf = (from: string, type: string, to: string): string => `${from} -${type}-> ${to}`;

const JOIN_ID = /^(.+) -([a-z_]+)-> (.+)$/;

/** A join id read back into its ends and type, or nothing when it is not one. */
export const joinOfId = (id: string): { from: string; type: string; to: string } | undefined => {
  const match = JOIN_ID.exec(id);
  return match === null ? undefined : { from: match[1]!, type: match[2]!, to: match[3]! };
};

/** A body as the file holds it, stamped with this version. */
export const observedOf = (body: Omit<Observed, 'observedFormatVersion'>): Observed => ({
  observedFormatVersion: OBSERVED_FORMAT_VERSION,
  ...body,
});

/** The file beside a database. */
export const observedPathFor = (dbPath: string): string => join(dirname(dbPath), OBSERVED_FILE);

// --- time ---------------------------------------------------------------------

/** The start of the hour `at` falls in, as an ISO string. */
export const hourOf = (at: string | number | Date): string => {
  const ms = typeof at === 'number' ? at : new Date(at).getTime();
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString();
};

const UNITS: Readonly<Record<string, number>> = { h: HOUR_MS, d: 24 * HOUR_MS, w: 7 * 24 * HOUR_MS };

/**
 * `2h`, `24h`, `7d`, `2w` as milliseconds; anything else, a part of an hour
 * included (`30m`), is undefined: the window is held in whole hours.
 */
export const parseDuration = (text: string): number | undefined => {
  const match = /^(\d+)([hdw])$/.exec(text.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  return amount > 0 ? amount * UNITS[match[2]!]! : undefined;
};

// --- the window ---------------------------------------------------------------

const sortedRecord = <V>(record: Record<string, V>): Record<string, V> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const unmatchedKey = (row: { service?: string; kind: string; name: string }): string =>
  `${row.service ?? ''}\u0000${row.kind}\u0000${row.name}`;
const ambiguousKey = (row: AmbiguousSpan): string =>
  `${row.service ?? ''}\u0000${row.kind}\u0000${row.name}\u0000${row.candidates.join('\u0000')}`;

const byCount = (
  a: { count: number; service?: string; kind: string; name: string },
  b: { count: number; service?: string; kind: string; name: string },
): number =>
  b.count - a.count ||
  (a.service ?? '').localeCompare(b.service ?? '') ||
  a.kind.localeCompare(b.kind) ||
  a.name.localeCompare(b.name);

const mergeJoin = (a: JoinAgg, b: JoinAgg): JoinAgg => {
  const merged: JoinAgg = mergeAgg(a, b);
  const callee = (a.callee ?? 0) + (b.callee ?? 0);
  if (callee > 0) merged.callee = callee;
  return merged;
};

const mergeRecords = <V extends Agg>(
  a: Record<string, V>,
  b: Record<string, V>,
  merge: (x: V, y: V) => V,
): Record<string, V> => {
  const merged: Record<string, V> = { ...a };
  for (const [id, agg] of Object.entries(b)) merged[id] = merged[id] === undefined ? agg : merge(merged[id]!, agg);
  return sortedRecord(merged);
};

const mergeUnmatched = (a: readonly UnmatchedAgg[], b: readonly UnmatchedAgg[]): UnmatchedAgg[] => {
  const rows = new Map<string, UnmatchedAgg>();
  for (const row of [...a, ...b]) {
    const key = unmatchedKey(row);
    const had = rows.get(key);
    const { service, kind, name } = row;
    rows.set(key, had === undefined ? row : { ...(service === undefined ? {} : { service }), kind, name, ...mergeAgg(had, row) });
  }
  return [...rows.values()].sort(byCount);
};

const mergeAmbiguous = (a: readonly AmbiguousSpan[], b: readonly AmbiguousSpan[]): AmbiguousSpan[] => {
  const rows = new Map<string, AmbiguousSpan>();
  for (const row of [...a, ...b]) {
    const key = ambiguousKey(row);
    const had = rows.get(key);
    rows.set(key, had === undefined ? { ...row } : { ...had, count: had.count + row.count });
  }
  return [...rows.values()].sort(byCount);
};

/** Two lists of hours as one: the same hour in both adds up. */
export const mergeBuckets = (a: readonly ObservedBucket[], b: readonly ObservedBucket[]): ObservedBucket[] => {
  const hours = new Map<string, ObservedBucket>();
  for (const bucket of [...a, ...b]) {
    const had = hours.get(bucket.hour);
    hours.set(
      bucket.hour,
      had === undefined
        ? bucket
        : {
            hour: bucket.hour,
            spans: had.spans + bucket.spans,
            joins: mergeRecords(had.joins, bucket.joins, mergeJoin),
            entries: mergeRecords(had.entries, bucket.entries, mergeAgg),
            symbols: mergeRecords(had.symbols, bucket.symbols, mergeAgg),
            channels: mergeRecords(had.channels, bucket.channels, mergeAgg),
            unmatched: mergeUnmatched(had.unmatched, bucket.unmatched),
            ambiguous: mergeAmbiguous(had.ambiguous, bucket.ambiguous),
          },
    );
  }
  return [...hours.values()].sort((x, y) => (x.hour < y.hour ? -1 : x.hour > y.hour ? 1 : 0));
};

const bySlowest = (a: ObservedSample, b: ObservedSample): number =>
  (b.ms ?? -1) - (a.ms ?? -1) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || a.traceId.localeCompare(b.traceId);
const byLatest = (a: ObservedSample, b: ObservedSample): number =>
  (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || a.traceId.localeCompare(b.traceId);

/** The kept few of two lists: one per trace, the newer list's copy first, then by `order`. */
const keepFew = (
  older: readonly ObservedSample[],
  newer: readonly ObservedSample[],
  order: (a: ObservedSample, b: ObservedSample) => number,
): ObservedSample[] => {
  const byTrace = new Map<string, ObservedSample>();
  for (const sample of [...newer, ...older]) if (!byTrace.has(sample.traceId)) byTrace.set(sample.traceId, sample);
  return [...byTrace.values()].sort(order).slice(0, SAMPLES_PER_ENTRY);
};

/** Samples of two runs as one: the slowest three and the latest three failing, per entry. */
export const mergeSamples = (
  older: Readonly<Record<string, EntrySamples>>,
  newer: Readonly<Record<string, EntrySamples>>,
): Record<string, EntrySamples> => {
  const merged: Record<string, EntrySamples> = {};
  for (const id of new Set([...Object.keys(older), ...Object.keys(newer)])) {
    const a = older[id] ?? { slow: [], failing: [] };
    const b = newer[id] ?? { slow: [], failing: [] };
    const slow = keepFew(a.slow, b.slow, bySlowest);
    const failing = keepFew(a.failing, b.failing, byLatest);
    if (slow.length + failing.length > 0) merged[id] = { slow, failing };
  }
  return sortedRecord(merged);
};

/**
 * The hours and samples inside `since` of `now`: an hour whose end is before
 * `now - since` is dropped, and a sample whose hour is. No `since` keeps all.
 */
export const cutWindow = (
  parts: { buckets: readonly ObservedBucket[]; samples: Readonly<Record<string, EntrySamples>> },
  since: string | undefined,
  now: Date,
): { buckets: ObservedBucket[]; samples: Record<string, EntrySamples> } => {
  const span = since === undefined ? undefined : parseDuration(since);
  if (span === undefined) return { buckets: [...parts.buckets], samples: { ...parts.samples } };
  const cutoff = now.getTime() - span;
  const inside = (hour: string): boolean => new Date(hour).getTime() + HOUR_MS >= cutoff;
  const samples: Record<string, EntrySamples> = {};
  for (const [id, kept] of Object.entries(parts.samples)) {
    const slow = kept.slow.filter((sample) => inside(hourOf(sample.at)));
    const failing = kept.failing.filter((sample) => inside(hourOf(sample.at)));
    if (slow.length + failing.length > 0) samples[id] = { slow, failing };
  }
  return { buckets: parts.buckets.filter((bucket) => inside(bucket.hour)), samples };
};

/**
 * A roll-up row's figures, in the order the file shows them. Nothing about
 * outcome is said of a row whose spans were all carried over from a version-1
 * or 2 file: those never recorded one (I3).
 */
const figuresOf = (agg: Agg): ObservedFigures => {
  const summary = summarise(agg);
  const known = agg.count - (agg.carried ?? 0) > 0;
  const figures: ObservedFigures = { firstSeen: summary.firstSeen };
  if (summary.p50 !== undefined) figures.p50 = summary.p50;
  if (summary.p95 !== undefined) figures.p95 = summary.p95;
  if (summary.max !== undefined) figures.max = summary.max;
  if (summary.statuses !== undefined) figures.statuses = summary.statuses;
  if (known) figures.errors = summary.errors;
  if (summary.errorRate !== undefined) figures.errorRate = summary.errorRate;
  return figures;
};

const measuredAtOf = (agg: JoinAgg): { measuredAt?: MeasuredAt } =>
  agg.count - (agg.carried ?? 0) === 0 ? {} : { measuredAt: (agg.callee ?? 0) >= agg.count - (agg.carried ?? 0) ? 'callee' : 'caller' };

export type ObservedRollUp = Pick<Observed, 'spans' | 'joins' | 'entries' | 'symbols' | 'channels' | 'unmatched' | 'ambiguous'>;

/** The window as one: every hour added up, under the names version 1 used. */
export const rollUp = (buckets: readonly ObservedBucket[]): ObservedRollUp => {
  // Every hour as the same hour, so merging them adds the whole window up.
  const all = mergeBuckets([], buckets.map((bucket) => ({ ...bucket, hour: '' })))[0];
  if (all === undefined) return { spans: 0, joins: {}, entries: {}, symbols: {}, channels: {}, unmatched: [], ambiguous: [] };
  const hits = (record: Record<string, Agg>): Record<string, HitSeen & { lastSeen: string | null }> =>
    Object.fromEntries(Object.entries(record).map(([id, agg]) => [id, { hits: agg.count, lastSeen: agg.lastSeen, ...figuresOf(agg) }]));
  return {
    spans: all.spans,
    joins: Object.fromEntries(
      Object.entries(all.joins).map(([id, agg]) => [id, { count: agg.count, lastSeen: agg.lastSeen, ...figuresOf(agg), ...measuredAtOf(agg) }]),
    ),
    entries: hits(all.entries),
    symbols: hits(all.symbols),
    channels: hits(all.channels),
    unmatched: all.unmatched.map(({ service, kind, name, ...agg }) => ({
      ...(service === undefined ? {} : { service }),
      kind,
      name,
      count: agg.count,
      lastSeen: agg.lastSeen,
      ...figuresOf(agg),
    })),
    ambiguous: all.ambiguous,
  };
};

export interface ObservedParts {
  buckets: readonly ObservedBucket[];
  samples: Readonly<Record<string, EntrySamples>>;
  sources: readonly ObservedSource[];
  droppedAttributes: number;
  since?: string;
  /** False when `--no-samples` said so: then the file holds no sample, and so no id. */
  samplesKept: boolean;
}

/** A whole file from its hours, samples and sources: the roll-up, the window and the privacy block. */
export const observedFromParts = (parts: ObservedParts): Observed => {
  const buckets = mergeBuckets([], parts.buckets);
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const rolled = rollUp(buckets);
  return observedOf({
    spans: rolled.spans,
    privacy: {
      kept: [...OBSERVED_KEPT],
      dropped: [...OBSERVED_DROPPED],
      droppedAttributes: parts.droppedAttributes,
      samples: { kept: parts.samplesKept, perEntry: SAMPLES_PER_ENTRY, spansPerSample: SPANS_PER_SAMPLE },
    },
    window: {
      ...(parts.since === undefined ? {} : { since: parts.since }),
      from: first?.hour ?? null,
      to: last === undefined ? null : new Date(new Date(last.hour).getTime() + HOUR_MS).toISOString(),
    },
    sources: [...parts.sources],
    joins: rolled.joins,
    entries: rolled.entries,
    symbols: rolled.symbols,
    channels: rolled.channels,
    unmatched: rolled.unmatched,
    ambiguous: rolled.ambiguous,
    samples: parts.samplesKept ? sortedRecord({ ...parts.samples }) : {},
    buckets,
  });
};

export interface MergeOptions {
  /** `--since`: a duration, or `all` to stop cutting; absent keeps what the file said. */
  since?: string;
  /** `--reset`: start from nothing. */
  reset?: boolean;
  /** `--no-samples` is `false`: no sample is written and the file's are removed. */
  samples?: boolean;
  now: Date;
}

/**
 * A run added to what the file held: hours added up, samples kept to the few,
 * sources listed, the window cut, everything rolled up again. The same spans
 * read in two runs give the same file as one run over both.
 */
export const mergeObserved = (previous: Observed | undefined, run: Observed, options: MergeOptions): Observed => {
  const base = options.reset === true ? undefined : previous;
  const since = options.since === 'all' ? undefined : (options.since ?? base?.window.since);
  const samplesKept = options.samples !== false;
  const cut = cutWindow(
    {
      buckets: mergeBuckets(base?.buckets ?? [], run.buckets),
      samples: samplesKept ? mergeSamples(base?.samples ?? {}, run.samples) : {},
    },
    since,
    options.now,
  );
  const sources = new Map<string, ObservedSource>();
  for (const source of [...(base?.sources ?? []), ...run.sources]) if (!sources.has(source.sha256)) sources.set(source.sha256, source);
  return observedFromParts({
    ...cut,
    sources: [...sources.values()],
    droppedAttributes: (base?.privacy.droppedAttributes ?? 0) + run.privacy.droppedAttributes,
    ...(since === undefined ? {} : { since }),
    samplesKept,
  });
};

// --- reading -----------------------------------------------------------------

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
const ambiguousRow = z.object({
  service: z.string().optional(),
  kind: z.string(),
  name: z.string(),
  candidates: z.array(z.string()),
  more: z.number().optional(),
  count: z.number(),
});
const unmatchedRow = z.object({ service: z.string().optional(), kind: z.string(), name: z.string(), count: z.number() });
const olderSchema = z.object({
  spans: z.number(),
  joins: z.record(z.string(), seen),
  entries: z.record(z.string(), hits.extend({ lastSeen: z.string().nullable().optional() })),
  symbols: z.record(z.string(), hits),
  channels: z.record(z.string(), hits),
  unmatched: z.array(unmatchedRow),
  ambiguous: z.array(ambiguousRow).optional(),
});
const counts = z.record(z.string(), z.number());
const agg = z.object({
  count: z.number(),
  errors: z.number(),
  statuses: counts.optional(),
  hist: counts.optional(),
  max: z.number().optional(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  carried: z.number().optional(),
});
const tree: z.ZodType<TraceTree> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    label: z.string(),
    service: z.string().optional(),
    kind: z.string(),
    ms: z.number().optional(),
    status: z.number().optional(),
    error: z.literal(true).optional(),
    children: z.array(tree).optional(),
  }),
);
const sample = z.object({
  traceId: z.string(),
  at: z.string(),
  ms: z.number().optional(),
  status: z.number().optional(),
  error: z.literal(true).optional(),
  spans: z.number(),
  cut: z.number().optional(),
  tree,
});
const currentSchema = olderSchema.extend({
  ambiguous: z.array(ambiguousRow),
  privacy: z.object({
    kept: z.array(z.string()),
    dropped: z.array(z.string()),
    droppedAttributes: z.number(),
    samples: z.object({ kept: z.boolean(), perEntry: z.number(), spansPerSample: z.number() }),
  }),
  window: z.object({ since: z.string().optional(), from: z.string().nullable(), to: z.string().nullable() }),
  sources: z.array(z.object({ sha256: z.string(), format: z.string(), spans: z.number(), readAt: z.string() })),
  samples: z.record(z.string(), z.object({ slow: z.array(sample), failing: z.array(sample) })),
  buckets: z.array(
    z.object({
      hour: z.string(),
      spans: z.number(),
      joins: z.record(z.string(), agg.extend({ callee: z.number().optional() })),
      entries: z.record(z.string(), agg),
      symbols: z.record(z.string(), agg),
      channels: z.record(z.string(), agg),
      unmatched: z.array(agg.extend({ service: z.string().optional(), kind: z.string(), name: z.string() })),
      ambiguous: z.array(ambiguousRow),
    }),
  ),
});

type OlderFile = z.infer<typeof olderSchema> & { observedFormatVersion: number };

const carriedAgg = (count: number, lastSeen: string | null | undefined): Agg => ({
  ...emptyAgg(),
  count,
  lastSeen: lastSeen ?? null,
  carried: count,
});

/**
 * A version-1 or version-2 file as version 3 (P105 D7): its counts become one
 * hour, the hour of its latest `lastSeen` (or `fallbackHour` when it has
 * none), with no timings and no outcome. `observedFormatVersion` stays the
 * file's, so a writer can say it upgraded it.
 */
export const upgradeObserved = (older: OlderFile, fallbackHour: string): Observed => {
  const times = [...Object.values(older.joins), ...Object.values(older.entries)].flatMap((row) =>
    row.lastSeen === undefined || row.lastSeen === null ? [] : [row.lastSeen],
  );
  const latest = times.sort().pop();
  const hourCounts = (record: Record<string, { hits: number; lastSeen?: string | null }>): Record<string, Agg> =>
    Object.fromEntries(Object.entries(record).map(([id, row]) => [id, carriedAgg(row.hits, row.lastSeen)]));
  const bucket: ObservedBucket = {
    hour: latest === undefined ? fallbackHour : hourOf(latest),
    spans: older.spans,
    joins: Object.fromEntries(Object.entries(older.joins).map(([id, row]) => [id, carriedAgg(row.count, row.lastSeen)])),
    entries: hourCounts(older.entries),
    symbols: hourCounts(older.symbols),
    channels: hourCounts(older.channels),
    unmatched: older.unmatched.map(({ service, kind, name, count }) => ({
      ...(service === undefined ? {} : { service }),
      kind: kind as UnmatchedKind,
      name,
      ...carriedAgg(count, null),
    })),
    ambiguous: (older.ambiguous ?? []) as AmbiguousSpan[],
  };
  const empty = older.spans === 0 && Object.keys(older.joins).length + Object.keys(older.entries).length === 0;
  return {
    ...observedFromParts({ buckets: empty ? [] : [bucket], samples: {}, sources: [], droppedAttributes: 0, samplesKept: true }),
    observedFormatVersion: older.observedFormatVersion,
  };
};

const problemOf = (path: string, kind: ObservedProblemKind, detail: string): ObservedRead => ({
  problem: { path, kind, detail },
});

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();

const invalid = (path: string, error: z.ZodError): ObservedRead => {
  const issue = error.issues[0];
  const at = issue === undefined || issue.path.length === 0 ? '(root)' : issue.path.join('.');
  return problemOf(path, 'invalid', `${at}: ${issue?.message ?? 'does not match the format'}`);
};

/** The hour the file was last written, for a version-1 or 2 file that says no time at all. */
const fileHour = (path: string): string => {
  try {
    return hourOf(statSync(path).mtimeMs);
  } catch {
    return hourOf(0);
  }
};

/**
 * The observed file at `path`, or why there is none: `missing`, `unparseable`
 * (not JSON), `invalid` (the wrong shape, with the field), `newer-version` or
 * `unknown-version`. A version-1 or 2 file reads upgraded to version 3's
 * shape (`upgradeObserved`), its version kept.
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
  if (version < OBSERVED_FORMAT_VERSION) {
    const older = olderSchema.safeParse(parsed);
    if (!older.success) return invalid(path, older.error);
    return { observed: upgradeObserved({ ...older.data, observedFormatVersion: version }, fileHour(path)) };
  }
  const current = currentSchema.safeParse(parsed);
  if (!current.success) return invalid(path, current.error);
  return { observed: parsed as Observed };
};

/** One sentence for a surface that reads the file. */
export const describeObservedProblem = (problem: ObservedProblem): string =>
  `${OBSERVED_FILE} at ${problem.path} cannot be read (${problem.detail}), so nothing seen at run time is shown`;
