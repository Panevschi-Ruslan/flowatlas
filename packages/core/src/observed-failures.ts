/**
 * What a way in answered at run time, set beside what its code says it fails
 * with (P106).
 *
 * P87 reads the failures off the code (`meta.fails`, grouped by
 * `groupFailures`); P105 keeps the statuses a way in really answered. Side by
 * side they answer two questions nothing else can: which failures the code
 * does not say it has (a 500 from an unhandled throw, a 409 from a constraint
 * nobody mapped), and which declared failures nobody hit in the window (dead
 * error paths, or untested ones).
 *
 * Pure: the CLI's page and doctor and the MCP server all call it, at read time,
 * so the graph is never touched (I7). Only statuses and counts are compared;
 * no exception text from traffic exists to compare (P105 §4).
 */
import { accessOf } from './access.js';
import { failuresOf, groupFailures, type Failure, type FailureGroup } from './failures.js';
import type { ObservedWindow } from './observed.js';

/** "Declared, never seen" is said only of a way in hit at least this often in the window (D2). */
export const FAILURE_MIN_HITS = 20;

/** A status counts as a failure from here up (D1), and as a status at all up to `599`. */
export const FAILURE_FROM = 400;
const STATUS_TO = 599;

/** A status seen that no failure of the way in declares. */
export interface UndeclaredFailure {
  status: number;
  /** Requests that answered it in the window. */
  count: number;
  /** `count` over the way in's hits, to four decimals. */
  share: number;
  /**
   * Why the framework is expected to answer it although no code declares it:
   * a router before the handler, a check in front of it, a body it could not
   * read. Said rather than dropped, so a reader sees why it is not flagged (I3).
   */
  expected?: string;
  /**
   * Declared failures that name no status and could be this one, by exception
   * (D4): beside the row, never folded into it.
   */
  maybe?: string[];
}

/** A declared failure whose status traffic answered. */
export interface DeclaredSeen {
  status: number;
  exception: string;
  count: number;
  /** The status is only the framework's default (P87): traffic, not the code, settled it. */
  assumed?: true;
}

/** A declared failure nothing in the window answered. */
export interface DeclaredNeverSeen {
  /** Absent for an exception whose status the code does not say. */
  status?: number;
  exception: string;
  /** Where its first place is: a node id where the graph draws one. */
  at: string;
  /** `file:line` of that place. */
  loc?: string;
}

export interface FailureComparison {
  entry: string;
  /** How many requests the way in had in the window. */
  hits: number;
  /** The hours the counts cover: "never seen" means "in these". */
  window: ObservedWindow;
  /** Unexpected first, then 5xx before 4xx, then the most common. */
  undeclared: UndeclaredFailure[];
  declaredSeen: DeclaredSeen[];
  declaredNeverSeen: DeclaredNeverSeen[];
  /** Fewer hits than the floor: a declared failure not seen is not said to be never seen (D2). */
  tooFewHits?: true;
}

/** What the comparison reads of a way in's traffic: its hits and the statuses it answered (`summarise`). */
export interface StatusMix {
  count: number;
  statuses?: Record<string, number>;
}

/** What the code says about a way in beyond its failures, for the `expected` reasons. */
export interface FailureContext {
  /** The HTTP method, as the entry records it. */
  method?: string;
  /** The checks in front of it that can refuse a request, by name (P76). */
  guards?: readonly string[];
}

export interface CompareOptions {
  window: ObservedWindow;
  /** The floor for "never seen"; `FAILURE_MIN_HITS` unless asked. */
  minHits?: number;
  context?: FailureContext;
}

/** The methods that carry a body the framework parses before any handler runs. */
const WITH_BODY: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Why a status nobody declares is still one the framework answers, by status:
 * a Strategy, so a status is one entry. A status with no entry, or whose entry
 * says nothing for this way in, is flagged.
 */
const EXPECTED: Readonly<Record<number, (context: FailureContext) => string | undefined>> = Object.freeze({
  400: ({ method }) =>
    method !== undefined && WITH_BODY.has(method.toUpperCase()) ? 'the framework refuses a body it cannot read' : undefined,
  401: ({ guards = [] }) => (guards.length > 0 ? `a check in front of it can refuse (${guards.join(', ')})` : undefined),
  403: ({ guards = [] }) => (guards.length > 0 ? `a check in front of it can refuse (${guards.join(', ')})` : undefined),
  404: () => 'the router answers it before the handler runs',
  405: () => 'the router answers it before the handler runs',
});

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** The failure statuses seen, in range, with their counts. */
const failureStatuses = (seen: StatusMix): Map<number, number> => {
  const found = new Map<number, number>();
  for (const [key, count] of Object.entries(seen.statuses ?? {})) {
    const status = Number(key);
    if (Number.isInteger(status) && status >= FAILURE_FROM && status <= STATUS_TO && count > 0) found.set(status, count);
  }
  return found;
};

/**
 * The statuses a declared group can answer, each with whether only the
 * framework's default says so: its own, or what its helper can choose (P90).
 */
/** What of a group says which statuses it can answer. */
export type GroupStatuses = Pick<FailureGroup, 'status' | 'assumed' | 'chosenFrom'>;

const statusesOf = (group: GroupStatuses): Map<number, boolean> => {
  if (group.status !== undefined) return new Map([[group.status, group.assumed === true]]);
  const found = new Map<number, boolean>();
  for (const choice of group.chosenFrom ?? []) {
    if (choice.status === undefined) continue;
    found.set(choice.status, (found.get(choice.status) ?? true) && choice.assumed === true);
  }
  return found;
};

/** How many requests answered a status the group declares; 0 for a group that names none. */
export const seenOfGroup = (group: GroupStatuses, seen: StatusMix): number => {
  const statuses = failureStatuses(seen);
  let count = 0;
  for (const status of statusesOf(group).keys()) count += statuses.get(status) ?? 0;
  return count;
};

const locOf = (item: Failure): string | undefined =>
  item.file === undefined ? undefined : item.line === undefined ? item.file : `${item.file}:${item.line}`;

const neverSeen = (group: FailureGroup, status?: number): DeclaredNeverSeen => {
  const [first] = group.at as [Failure, ...Failure[]];
  const loc = locOf(first);
  return { ...(status === undefined ? {} : { status }), exception: group.exception, at: first.at, ...(loc === undefined ? {} : { loc }) };
};

const byUndeclared = (a: UndeclaredFailure, b: UndeclaredFailure): number =>
  Number(a.expected !== undefined) - Number(b.expected !== undefined) ||
  Number(b.status >= 500) - Number(a.status >= 500) ||
  b.count - a.count ||
  a.status - b.status;

/**
 * The statuses a way in answered against the failures it declares, over the
 * window the observed file holds; undefined for a way in whose spans carried
 * no status (not HTTP), since there is nothing to compare.
 *
 * `declared` is `groupFailures(failuresOf(node))`; `seen` the way in's
 * roll-up row. An `assumed` group seen is confirmed (`assumed` on its
 * `declaredSeen` row); one never seen is not reported, the code never having
 * declared it. A group with no status matches nothing by status: it is
 * `maybe` beside each undeclared status no reason explains, and "never seen"
 * only when there is none.
 */
export const compareSeenFailures = (
  entry: string,
  declared: readonly FailureGroup[],
  seen: StatusMix,
  options: CompareOptions,
): FailureComparison | undefined => {
  if (seen.statuses === undefined || Object.keys(seen.statuses).length === 0) return undefined;
  const minHits = options.minHits ?? FAILURE_MIN_HITS;
  const context = options.context ?? {};
  const statuses = failureStatuses(seen);
  const hits = seen.count;

  const claimed = new Set<number>();
  const declaredSeen: DeclaredSeen[] = [];
  const candidates: DeclaredNeverSeen[] = [];
  const statusless: FailureGroup[] = [];
  for (const group of declared) {
    const answers = statusesOf(group);
    if (answers.size === 0) {
      statusless.push(group);
      continue;
    }
    for (const [status, assumed] of answers) {
      claimed.add(status);
      const count = statuses.get(status);
      if (count !== undefined) {
        declaredSeen.push({ status, exception: group.exception, count, ...(assumed ? { assumed: true as const } : {}) });
      } else if (!assumed) {
        candidates.push(neverSeen(group, status));
      }
    }
  }

  const undeclared: UndeclaredFailure[] = [...statuses]
    .filter(([status]) => !claimed.has(status))
    .map(([status, count]) => {
      const expected = EXPECTED[status]?.(context);
      return { status, count, share: hits > 0 ? round4(count / hits) : 0, ...(expected === undefined ? {} : { expected }) };
    });
  // A failure that names no status could be any status nothing explains (D4).
  const open = undeclared.filter((row) => row.expected === undefined);
  const maybe = statusless.map((group) => group.exception);
  if (maybe.length > 0) for (const row of open) row.maybe = [...new Set(maybe)];
  if (open.length === 0) candidates.push(...statusless.map((group) => neverSeen(group)));

  const enough = hits >= minHits;
  return {
    entry,
    hits,
    window: options.window,
    undeclared: undeclared.sort(byUndeclared),
    declaredSeen,
    declaredNeverSeen: enough ? candidates : [],
    ...(!enough && candidates.length > 0 ? { tooFewHits: true as const } : {}),
  };
};

/** The method and the checks in front of a way in, read off its node. */
export const failureContextOf = (node: { meta?: Record<string, unknown> }): FailureContext => {
  const method = node.meta?.['method'];
  const guards = (accessOf(node)?.guards ?? []).filter((guard) => guard.skippedBy === undefined).map((guard) => guard.name);
  return { ...(typeof method === 'string' ? { method } : {}), ...(guards.length === 0 ? {} : { guards: [...new Set(guards)] }) };
};

/** `compareSeenFailures` for an entry node: its declared failures and context read off the node. */
export const compareEntryFailures = (
  node: { id: string; meta?: Record<string, unknown> },
  seen: StatusMix,
  options: Omit<CompareOptions, 'context'>,
): FailureComparison | undefined =>
  compareSeenFailures(node.id, groupFailures(failuresOf(node)), seen, { ...options, context: failureContextOf(node) });

/** Whether a comparison has anything to say: a status not declared, a declared one seen or never seen, or a floor not met. */
export const comparisonSays = (comparison: FailureComparison | undefined): comparison is FailureComparison =>
  comparison !== undefined &&
  (comparison.undeclared.length > 0 ||
    comparison.declaredSeen.length > 0 ||
    comparison.declaredNeverSeen.length > 0 ||
    comparison.tooFewHits === true);
