/**
 * The fingerprint of what a doc block shows (P120 D2): its meaning, never its
 * text.
 *
 * A renderer that draws the same walk differently, or a line that moved
 * because an import was added above it, must not fail a docs check; a new
 * step, a step gone, or a shape that changed must. So what is hashed is the
 * walk the block is drawn from - each row's node id with any position taken
 * out, how it was reached (edge type and confidence) and the type ids it
 * carries in and out, in walk order - and the steps between participants it
 * reads as, without the file and line each is written at. A view that shows
 * more (a contract's fields, a prompt's gaps) hands that in as `extra`.
 */
import { createHash } from 'node:crypto';
import { stableJson } from '../diff/fingerprint.js';
import type { RecordedStep } from './blocks.js';

/** A row of a walk, as much of `FlowNode` (mcp) as a fingerprint reads. */
export interface FingerprintTree {
  node: { id: string; type: string; label: string; ref?: true };
  edge?: { type: string; confidence: string; params?: readonly string[]; returns?: string };
  children: readonly FingerprintTree[];
}

/**
 * An id without the place it is written: a call site, a query or a click is
 * named by its file, line and column (`http_out:gateway#src/a.ts:33:12`), and
 * the line is exactly what a reformat moves. The label, which says what the
 * call is, stands in for it.
 */
export const positionFreeId = (node: Pick<FingerprintTree['node'], 'id' | 'label'>): string => {
  const cut = /:\d+:\d+$/.exec(node.id);
  return cut === null ? node.id : `${node.id.slice(0, cut.index)}|${node.label}`;
};

/** The rows of a walk, depth first, as the fingerprint reads them. */
export const fingerprintRows = (tree: FingerprintTree): unknown[] => {
  const rows: unknown[] = [];
  const visit = (row: FingerprintTree, depth: number): void => {
    rows.push([
      depth,
      positionFreeId(row.node),
      row.node.type,
      row.edge?.type ?? null,
      row.edge?.confidence ?? null,
      row.edge?.params ?? [],
      row.edge?.returns ?? null,
      row.node.ref === true ? 1 : 0,
    ]);
    for (const child of row.children) visit(child, depth + 1);
  };
  visit(tree, 0);
  return rows;
};

/** How many hex characters a fingerprint keeps: short enough to read in a marker, long enough not to collide by chance in one project. */
export const FINGERPRINT_LENGTH = 8;

/**
 * The fingerprint of a walk and the steps it reads as, plus whatever else the
 * view shows. Stable across runs and machines: keys sorted (`stableJson`), no
 * positions, no absolute paths.
 */
export const flowFingerprint = (tree: FingerprintTree, steps: readonly RecordedStep[] = [], extra?: unknown): string =>
  createHash('sha256')
    .update(stableJson({ rows: fingerprintRows(tree), steps, ...(extra === undefined ? {} : { extra }) }))
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
