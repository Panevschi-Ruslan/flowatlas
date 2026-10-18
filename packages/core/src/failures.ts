/**
 * What a way in can fail with (P68).
 *
 * Read off the code a way in reaches - what its handler and everything it
 * calls throw, and what the checks in front of it refuse a request with - and
 * written on the entry node under `meta.fails`, so a reader leading with "what
 * can go wrong here" has the answer without walking the chain.
 */
import { compareFailChoices, groupFails } from './prompt-text.js';

/**
 * Where a failure comes from: a body's `throw`, a guard's or a pipe's refusal,
 * or what an interceptor gives in place of an error that reached it, or
 * raises itself (`timeout()`), written where the interceptor writes it (P207).
 */
export const FAILURE_SOURCES = ['throw', 'guard', 'pipe', 'interceptor'] as const;

export type FailureSource = (typeof FAILURE_SOURCES)[number];

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
  /**
   * The exception is built by a helper and chosen there at run time (P90):
   * `throw toHttpError(result)`. `exception` is then the helper's name, since
   * naming one of the classes it can give would be a guess.
   */
  via?: 'helper';
  /**
   * Every exception the helper can give, read off its table, with the status
   * each answers (P90). `status` above is set only when every choice agrees.
   * Absent where the helper's answer could not be read.
   */
  chosenFrom?: FailureChoice[];
  /**
   * What the failure is about, where that is all that could be read (P90):
   * `auth` when the throw refuses a request whose check, by the words the code
   * uses for it, is about who is asking (`soundsLikeAuthCheck`).
   */
  family?: 'auth';
}

/** One exception a helper can choose to throw (P90). */
export interface FailureChoice {
  exception: string;
  status?: number;
  /** The status is the framework's default for it, written nowhere (P87). */
  assumed?: true;
}

/** Whether a failure's status, or any status its helper can choose, is one of these (P90). */
export const failsWithAny = (item: Failure, statuses: ReadonlySet<number>): boolean =>
  (item.status !== undefined && statuses.has(item.status)) ||
  (item.chosenFrom ?? []).some((choice) => choice.status !== undefined && statuses.has(choice.status));

const choiceKey = (choices: readonly FailureChoice[] | undefined): string =>
  choices === undefined
    ? ''
    : choices.map((choice) => `${choice.exception}/${choice.status ?? ''}${choice.assumed === true ? '?' : ''}`).join(',');

/** The order choices are written in: by status, then exception; the prompt renderer's, so there is one (P97). */
export const compareChoices: (a: FailureChoice, b: FailureChoice) => number = compareFailChoices;

/** The key on an entry's `meta` that holds its failures. */
export const FAILS_META = 'fails';

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
    item.via ?? '',
    choiceKey(item.chosenFrom),
    item.family ?? '',
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
  /** Present when every site throws what a helper chose (P90). */
  via?: 'helper';
  /** What the helper can choose, every site's choices once, by status then exception (P90). */
  chosenFrom?: FailureChoice[];
  /** Present when every site says the same (P90). */
  family?: 'auth';
  /** How the sites come about, in `FAILURE_SOURCES` order, each once. */
  sources: FailureSource[];
  /** How many places raise it. */
  sites: number;
  /** The sites themselves, in the stored order. */
  at: Failure[];
}

/**
 * Each (status, exception) once, by status then exception, with its sites.
 * One implementation, the prompt renderer's (P97): the page groups with it too,
 * and a group written two ways would be two texts.
 */
export const groupFailures = (fails: readonly Failure[]): FailureGroup[] => groupFails(fails);
