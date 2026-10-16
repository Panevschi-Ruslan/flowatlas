import { accessOf, type GraphNode } from '@flowatlas/core';

/**
 * What stands in front of each way in, and from where, for the page (P76).
 *
 * Keyed by the entry's position in `nodes`. `g` lists the checks in the order
 * they run, each as `[name, where, via, skippedBy?]` — `where` is `global`,
 * `module`, `controller` or `route`, `via` how it was attached
 * (`APP_GUARD in AuthModule`), and `skippedBy` the decorator that switches it
 * off for this route. `o` lists the opt-outs written on the handler or its
 * class as `[decorator, public, where, skips]`, `public` 1 when the decorator
 * says the route is open on purpose and `skips` the checks that read its flag,
 * comma-separated.
 */
export interface PackedAccessOf {
  g: Array<[name: string, where: string, via: string, skippedBy?: string]>;
  o?: Array<[decorator: string, isPublic: 0 | 1, where: string, skips: string]>;
}

export type PackedAccess = Record<number, PackedAccessOf>;

export const packAccess = (nodes: readonly GraphNode[]): PackedAccess | undefined => {
  const out: PackedAccess = {};
  nodes.forEach((node, index) => {
    if (node.type !== 'entry') return;
    const access = accessOf(node);
    if (access === undefined) return;
    out[index] = {
      g: access.guards.map((guard) =>
        guard.skippedBy === undefined
          ? [guard.name, guard.where, guard.via]
          : [guard.name, guard.where, guard.via, guard.skippedBy],
      ),
      ...(access.optOuts === undefined
        ? {}
        : {
            o: access.optOuts.map(
              (item) => [item.decorator, item.public ? 1 : 0, item.where, item.skips.join(', ')] as [string, 0 | 1, string, string],
            ),
          }),
    };
  });
  return Object.keys(out).length === 0 ? undefined : out;
};
