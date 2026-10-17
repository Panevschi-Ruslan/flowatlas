import {
  failuresOf,
  groupFailures,
  seenOfGroup,
  type Failure,
  type FailureChoice,
  type FailureComparison,
  type FailureGroup,
  type GraphNode,
  type StatusMix,
} from '@flowatlas/core';

/** One place a failure comes from, at `detail >= 2` (P87). */
export interface FailPlace {
  /** Where it is thrown or checked: a node id where the graph draws one. */
  at: string;
  /** `file:line`. */
  loc?: string;
  source: Failure['source'];
}

/**
 * One status and exception a way in fails with, as it goes over the wire
 * (P68, grouped in P87): each answer once, with how many places raise it.
 */
export interface FailRef {
  status?: number;
  exception: string;
  /** The status is the framework's default, written nowhere on the path. */
  assumed?: true;
  /** The status the thrown class states for itself, where nothing maps it. */
  declared?: number;
  /** `exception` is a helper that chooses what is thrown at run time (P90). */
  via?: 'helper';
  /** What the helper can choose, with the status each answers (P90). */
  chosenFrom?: FailureChoice[];
  /** `auth`: the throw refuses a check of who is asking whose answer the helper turns into the exception (P90). */
  family?: 'auth';
  /** How the places come about: `throw`, `guard`, `pipe`. */
  sources: Failure['source'][];
  /** How many places raise it. */
  sites: number;
  /** The first place: a node id where the graph draws one. */
  at: string;
  /** `file:line` of the first place. */
  loc?: string;
  /** Every place, at `detail >= 2`. */
  places?: FailPlace[];
  /** Requests that answered a status it declares, in the observed window (P106); absent when none did or nothing was observed. */
  seen?: number;
}

/**
 * What an entry answered at run time against what it declares (P106), as
 * `get_flow` and `describe_for_prompt` carry it: the statuses no failure
 * declares and the declared failures never seen, over the window. Which
 * declared ones were seen is each `FailRef.seen`.
 */
export interface FailuresSeenRef {
  hits: number;
  window: FailureComparison['window'];
  undeclared: FailureComparison['undeclared'];
  declaredNeverSeen: FailureComparison['declaredNeverSeen'];
  tooFewHits?: true;
}

/** The wire form of a comparison. */
export const failuresSeenRef = (comparison: FailureComparison): FailuresSeenRef => ({
  hits: comparison.hits,
  window: comparison.window,
  undeclared: comparison.undeclared,
  declaredNeverSeen: comparison.declaredNeverSeen,
  ...(comparison.tooFewHits === true ? { tooFewHits: true as const } : {}),
});

/** Sets `seen` on each failure row whose status traffic answered (P106). */
export const markFailsSeen = (fails: readonly FailRef[] | undefined, statuses: StatusMix): void => {
  for (const fail of fails ?? []) {
    const count = seenOfGroup(fail, statuses);
    if (count > 0) fail.seen = count;
  }
}

const locOf = (item: Failure): string | undefined =>
  item.file === undefined ? undefined : item.line === undefined ? item.file : `${item.file}:${item.line}`;

const placeOf = (item: Failure): FailPlace => {
  const loc = locOf(item);
  return { at: item.at, ...(loc === undefined ? {} : { loc }), source: item.source };
};

const refOf = (group: FailureGroup, detail: number): FailRef => {
  const [first] = group.at as [Failure, ...Failure[]];
  const loc = locOf(first);
  return {
    ...(group.status === undefined ? {} : { status: group.status }),
    exception: group.exception,
    ...(group.assumed === true ? { assumed: true as const } : {}),
    ...(group.declared === undefined ? {} : { declared: group.declared }),
    ...(group.via === undefined ? {} : { via: group.via }),
    ...(group.chosenFrom === undefined ? {} : { chosenFrom: group.chosenFrom }),
    ...(group.family === undefined ? {} : { family: group.family }),
    sources: group.sources,
    sites: group.sites,
    at: first.at,
    ...(loc === undefined ? {} : { loc }),
    ...(detail >= 2 ? { places: group.at.map(placeOf) } : {}),
  };
};

/**
 * What an entry can fail with, read off its `meta.fails` and grouped by status
 * and exception; none for anything else. The places behind each group are
 * listed at `detail >= 2`.
 */
export const failsOf = (node: Pick<GraphNode, 'type' | 'meta'> | undefined, detail = 1): FailRef[] =>
  node?.type !== 'entry' ? [] : groupFailures(failuresOf(node)).map((group) => refOf(group, detail));
