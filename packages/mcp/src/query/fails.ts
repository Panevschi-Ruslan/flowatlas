import { failuresOf, type Failure, type GraphNode } from '@flowatlas/core';

/** One way a way in fails, as it goes over the wire (P68). */
export interface FailRef {
  status?: number;
  exception: string;
  /** Where it is thrown or checked: a node id where the graph draws one. */
  at: string;
  /** `file:line`. */
  loc?: string;
  source: Failure['source'];
}

const locOf = (item: Failure): string | undefined =>
  item.file === undefined ? undefined : item.line === undefined ? item.file : `${item.file}:${item.line}`;

/** What an entry can fail with, read off its `meta.fails`; none for anything else. */
export const failsOf = (node: Pick<GraphNode, 'type' | 'meta'> | undefined): FailRef[] =>
  node?.type !== 'entry'
    ? []
    : failuresOf(node).map((item) => {
        const loc = locOf(item);
        return {
          ...(item.status === undefined ? {} : { status: item.status }),
          exception: item.exception,
          at: item.at,
          ...(loc === undefined ? {} : { loc }),
          source: item.source,
        };
      });
