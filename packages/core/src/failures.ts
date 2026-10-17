/**
 * What a way in can fail with (P68).
 *
 * Read off the code a way in reaches - what its handler and everything it
 * calls throw, and what the checks in front of it refuse a request with - and
 * written on the entry node under `meta.fails`, so a reader leading with "what
 * can go wrong here" has the answer without walking the chain.
 */

/** Where a failure comes from. */
export const FAILURE_SOURCES = ['throw', 'guard', 'pipe'] as const;

export type FailureSource = (typeof FAILURE_SOURCES)[number];

export interface Failure {
  /**
   * The status the caller gets back. Absent where the code does not say one:
   * an exception whose status is computed, or one that is not a request's to
   * answer.
   */
  status?: number;
  /** The name of what is thrown, as the code writes it. */
  exception: string;
  /** Id of the code the failure is written in: a node id where the graph draws one, a symbol id of the same grammar for a helper it does not. */
  at: string;
  /** Repo-relative path and line of the throw, or of the check. */
  file?: string;
  line?: number;
  source: FailureSource;
  /**
   * The status was written nowhere on the path: what the framework answers an
   * error nothing maps, a class whose own status no filter reads, a chain of
   * bases too long to follow (P87). Said so, never stated as fact.
   */
  assumed?: true;
  /** The status the thrown class declares for itself, where nothing maps it and the caller gets `status` instead (P87). */
  declared?: number;
}

/** The key on an entry's `meta` that holds its failures. */
export const FAILS_META = 'fails';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order failures are written in: by status, then exception, then place. */
export const compareFailures = (a: Failure, b: Failure): number =>
  (a.status ?? 1000) - (b.status ?? 1000) ||
  cmp(a.exception, b.exception) ||
  cmp(a.at, b.at) ||
  cmp(a.file ?? '', b.file ?? '') ||
  (a.line ?? 0) - (b.line ?? 0);

const failureKey = (item: Failure): string =>
  [
    item.status ?? '',
    item.exception,
    item.at,
    item.file ?? '',
    item.line ?? '',
    item.source,
    item.assumed === true ? 1 : '',
    item.declared ?? '',
  ].join('\u0000');

/** One list, without repeats, in a stable order. */
export const settleFailures = (items: Iterable<Failure>): Failure[] => {
  const byKey = new Map<string, Failure>();
  for (const item of items) {
    const key = failureKey(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()].sort(compareFailures);
};

const isFailure = (value: unknown): value is Failure => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row['exception'] === 'string' && typeof row['at'] === 'string';
};

/** The failures a node's `meta` holds, read defensively; none when absent. */
export const failuresOf = (node: { meta?: Record<string, unknown> } | undefined): Failure[] => {
  const value = node?.meta?.[FAILS_META];
  return Array.isArray(value) ? value.filter(isFailure) : [];
};

/**
 * One status and exception a way in fails with, and every place it comes from
 * (P87).
 *
 * The stored list is one row per site, which is what a mark on a step needs;
 * a reader asking "what can this answer" wants each answer once, with how many
 * places raise it. Grouping is a read: nothing on disk changes.
 */
export interface FailureGroup {
  status?: number;
  exception: string;
  /** Present when every site of the group is assumed. */
  assumed?: true;
  /** The status the class declares, when every site agrees on one. */
  declared?: number;
  /** How the sites come about, in `FAILURE_SOURCES` order, each once. */
  sources: FailureSource[];
  /** How many places raise it. */
  sites: number;
  /** The sites themselves, in the stored order. */
  at: Failure[];
}

const groupKey = (item: Failure): string => `${item.status ?? ''}\u0000${item.exception}`;

/** Each (status, exception) once, by status then exception, with its sites. */
export const groupFailures = (fails: readonly Failure[]): FailureGroup[] => {
  const byKey = new Map<string, Failure[]>();
  for (const item of fails) {
    const key = groupKey(item);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [item]);
    else list.push(item);
  }
  const groups = [...byKey.values()].map((at): FailureGroup => {
    const [first] = at as [Failure, ...Failure[]];
    const declared = at.every((item) => item.declared !== undefined && item.declared === first.declared)
      ? first.declared
      : undefined;
    const used = new Set(at.map((item) => item.source));
    return {
      ...(first.status === undefined ? {} : { status: first.status }),
      exception: first.exception,
      ...(at.every((item) => item.assumed === true) ? { assumed: true as const } : {}),
      ...(declared === undefined ? {} : { declared }),
      sources: FAILURE_SOURCES.filter((source) => used.has(source)),
      sites: at.length,
      at,
    };
  });
  return groups.sort((a, b) => (a.status ?? 1000) - (b.status ?? 1000) || cmp(a.exception, b.exception));
};
