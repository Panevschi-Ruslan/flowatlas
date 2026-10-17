import { keepAllowed, type ObservedSpan } from '../span.js';

/**
 * What every trace reader shares: the reader contract, the counting of what
 * was not read, and the small value checks a reader makes before it trusts a
 * field. A reader is a Strategy (`index.ts` lists them); this file has no
 * format of its own.
 */

/** A flag of `observe` that only some formats take (P108). */
export type ReaderFlag = 'workflow' | 'function' | 'accessLogKeys';

/**
 * What an access log's keys are called when a team named them differently
 * from the documented examples (`--access-log-keys route=rk,status=st`): each
 * role to the one key that holds it.
 */
export type AccessLogRole = 'route' | 'method' | 'path' | 'status' | 'latency' | 'time';
export type AccessLogKeys = Partial<Readonly<Record<AccessLogRole, string>>>;

/** The project's front ends and the services their base URLs point at (P77, P112). */
export interface FrontEndContext {
  /** The services the map has browser calls (`ui_api_call`) for, sorted. */
  frontEnds: readonly string[];
  /**
   * The service a call from `frontEnd` to `origin` reaches, as the
   * configuration says, or nothing when nothing does. The origin is asked
   * about and never kept.
   */
  serviceAt(origin: string, frontEnd: string): string | undefined;
}

/** What `observe` knows about a file beside its contents (P112); every field is optional. */
export interface ReadContext {
  /** The sha256 of the file the document is in: a format with no ids of its own makes them from it. */
  source?: string;
  /** Where the project's front ends send their calls, asked only by a reader of a browser's record. */
  frontEnd?: () => FrontEndContext;
}

/**
 * What `observe` says beside a file: the names a file may not say itself
 * (P108), and what it knows of the file and the project (`ReadContext`, P112).
 */
export interface ReaderOptions extends ReadContext {
  /** `--workflow`: the state machine an execution history is of, when the file does not say. */
  workflow?: string;
  /** `--function`: the function REPORT lines are of, when no log group says. */
  function?: string;
  /** `--access-log-keys`: the keys an access log's format uses. */
  accessLogKeys?: AccessLogKeys;
  /**
   * Which document of the file this is (a file of JSON lines is one document a
   * line), so spans made up for lines that carry no id stay apart.
   */
  part?: number;
}

/**
 * One way a trace file can be written, as a Strategy: `sniff` says whether a
 * parsed document is this format, `read` turns it into spans. Readers are pure
 * and copy over only the fields their allow-list names (`allow-list.ts`), so a
 * header, a query string, a body or a statement never leaves the reader.
 */
export interface TraceReader {
  name: string;
  sniff(document: unknown, options?: ReaderOptions): boolean;
  read(document: unknown, fallbackService?: string, options?: ReaderOptions): TraceRead;
  /** The flags this format takes; any other one given for a file of it is an error. */
  takes?: readonly ReaderFlag[];
}

/** Parts of a file a reader saw and did not read, counted so nothing is dropped unsaid. */
export interface SkippedPart {
  noun: 'snapshot' | 'job' | 'node' | 'span' | 'segment' | 'subsegment' | 'event' | 'line' | 'entry';
  /** Why, as it reads after the noun: `of protocol ws`, `without o, c and m`. */
  why: string;
  count: number;
}

export interface TraceRead {
  spans: ObservedSpan[];
  skipped: SkippedPart[];
  /**
   * Attribute keys seen and not read (OTLP attributes, @nestjs/observe fields
   * and tags, X-Ray segment fields, log fields), counted each time one is
   * seen: the file's privacy block says how many, never which.
   */
  droppedAttributes: number;
  /** Fixed sentences the summary says about the file, never quoting it (P112). */
  notes?: string[];
}

/**
 * A file a reader refuses (P112). The message says the format, the record's
 * index and the field only: a line of the file quoted in an error would be a
 * leak in a terminal or a CI log.
 */
export class TraceFileError extends Error {}

/**
 * A file that needs a name it does not say, and that only a flag can give
 * (P108 D2): refused rather than counted on a guess. `observe` adds the file.
 */
export class NameNeeded extends Error {
  constructor(
    message: string,
    readonly flag: '--workflow' | '--function',
  ) {
    super(message);
    this.name = 'NameNeeded';
  }
}

export type Json = Record<string, unknown>;

export const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** A number a log writes as a number or as a string of digits (`"180"`, `"12.5"`). */
export const numberOf = (value: unknown): number | undefined => {
  if (typeof value === 'number') return amount(value);
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : undefined;
};

/** Counts what was skipped, by noun and reason, in the order first seen. */
export class Skips {
  private readonly parts = new Map<string, SkippedPart>();

  add(noun: SkippedPart['noun'], why: string): void {
    const key = `${noun}\u0000${why}`;
    const part = this.parts.get(key);
    if (part === undefined) this.parts.set(key, { noun, why, count: 1 });
    else part.count += 1;
  }

  list(): SkippedPart[] {
    return [...this.parts.values()];
  }
}

/** Sets the fields that have a value, then keeps only the allowed ones (`keepAllowed`). */
export const withFields = (span: ObservedSpan, fields: Partial<ObservedSpan>): ObservedSpan => {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (span as unknown as Json)[key] = value;
  }
  return keepAllowed(span);
};

/** Counts keys a reader saw and did not read; the count is all that is kept of them. */
export class Dropped {
  count = 0;

  /** The keys of `value` outside `fields`. */
  outside(value: unknown, fields: readonly string[]): void {
    if (!isObject(value)) return;
    for (const key of Object.keys(value)) if (!fields.includes(key)) this.count += 1;
  }
}

/** Milliseconds to two decimals. */
export const ms2 = (ms: number): number => Math.round(ms * 100) / 100;

/** A duration a batch states in milliseconds, to two decimals; nothing when it is not a number (I3). */
export const msOf = (value: unknown): number | undefined => {
  const ms = amount(value);
  return ms === undefined ? undefined : ms2(ms);
};

/** An HTTP status, only when it is one. */
export const statusOf = (value: unknown): number | undefined => {
  const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(status) && status >= 100 && status < 600 ? status : undefined;
};

/** A time as ISO, from milliseconds since the epoch. */
export const isoOfMs = (ms: number | undefined): string | undefined =>
  ms === undefined || !Number.isFinite(ms) || ms <= 0 ? undefined : new Date(Math.round(ms)).toISOString();

/** A time in microseconds since the epoch, as Zipkin and Jaeger write one, as ISO; nothing for 0 or none. */
export const microsToIso = (value: unknown): string | undefined => {
  const micros = amount(value);
  return micros === undefined || micros === 0 ? undefined : new Date(Math.floor(micros / 1000)).toISOString();
};

/** A duration in microseconds, in milliseconds to two decimals. */
export const microsToMs = (value: unknown): number | undefined => {
  const micros = amount(value);
  return micros === undefined ? undefined : ms2(micros / 1000);
};

/** A time a file writes as text, as ISO, once `Date.parse` trusts it. */
export const isoOfText = (value: unknown): string | undefined => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
};

/** `putItem`, `invoke.waitForTaskToken`: the operation as a span spells it, `PutItem`, `Invoke`. */
export const operationName = (word: string): string | undefined => {
  const base = word.split(/[.:]/)[0] ?? '';
  return /^[A-Za-z][A-Za-z0-9]*$/.test(base) ? base.charAt(0).toUpperCase() + base.slice(1) : undefined;
};
