import type { GraphEdge } from '@flowatlas/core';

/**
 * Byte-wise, locale-independent comparison.
 *
 * Every list this package produces is sorted with it, so two runs over
 * unchanged input produce byte-identical output on any machine.
 */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What makes an edge the same edge: where it starts, what it is, where it ends. */
export const edgeKey = (edge: GraphEdge): string => `${edge.from} ${edge.type} ${edge.to}`;
