import { failuresOf, groupFailures, type Failure, type FailureGroup, type GraphNode } from '@flowatlas/core';

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
