import { failuresOf, type Failure, type GraphNode } from '@flowatlas/core';

/**
 * What each way in can fail with, for the page's error card (P68).
 *
 * Keyed by the entry's position in `nodes`. `at` is the position of the node
 * the failure is written in, or -1 when the graph does not draw it (a helper
 * nothing else puts on the map), in which case `id` names it.
 */
export interface PackedFail {
  /** The status the caller gets back; absent when the code says none. */
  s?: number;
  /** The exception, as the code writes it. */
  x: string;
  at: number;
  id?: string;
  /** Repo-relative file and line of the throw or the check. */
  f?: string;
  l?: number;
  src: Failure['source'];
}

export type PackedFails = Record<number, PackedFail[]>;

export const packFails = (nodes: readonly GraphNode[], position: ReadonlyMap<string, number>): PackedFails | undefined => {
  const out: PackedFails = {};
  nodes.forEach((node, index) => {
    if (node.type !== 'entry') return;
    const fails = failuresOf(node);
    if (fails.length === 0) return;
    out[index] = fails.map((item) => {
      const at = position.get(item.at) ?? -1;
      return {
        ...(item.status === undefined ? {} : { s: item.status }),
        x: item.exception,
        at,
        ...(at === -1 ? { id: item.at } : {}),
        ...(item.file === undefined ? {} : { f: item.file }),
        ...(item.line === undefined ? {} : { l: item.line }),
        src: item.source,
      };
    });
  });
  return Object.keys(out).length === 0 ? undefined : out;
};
