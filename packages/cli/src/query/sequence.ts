import type { GraphEdge } from '@flowatlas/core';
import { DEFAULT_BLAST_DEPTH, sequenceOf, type GraphDb, type Sequence, type SequenceDetail } from '@flowatlas/linker';
import { buildFlowTree, defaultFlowDepth, SEQUENCE_WALK_DETAIL, sitesFrom, stopsIn, type FlowNode } from '@flowatlas/mcp';

/*
 * Why a walk stops at a row, the edge site behind a row and the detail a
 * sequence is walked at are the server's (P120), so a doc block and `diff`
 * read one sequence the same way. Re-exported for the commands that walk.
 */
export { SEQUENCE_WALK_DETAIL, sitesFrom, stopsIn };

/**
 * How far a sequence is walked when nobody says: at least as far as `diff`
 * walks back from a change to the ways in it lists, so the flow of a way in
 * reaches the change it was listed for, and further for a chain of steps
 * (`defaultFlowDepth`). `maxNodes` still bounds it (I9).
 */
export const sequenceDepth = (entry: Parameters<typeof defaultFlowDepth>[0]): number =>
  Math.max(defaultFlowDepth(entry), DEFAULT_BLAST_DEPTH);

export interface SequenceWalk {
  sequence: Sequence;
  truncated?: string;
}

/**
 * One way in walked and read as a sequence: `buildFlowTree` to
 * `sequenceDepth` and `maxNodes`, the edge sites and the stops read off the
 * same graph. What `flowatlas diff` does on each side of a flow.
 */
export const walkSequence = (db: GraphDb, entryId: string, options: { maxNodes: number; detail: SequenceDetail }): SequenceWalk => {
  const edgesOf = new Map<FlowNode, GraphEdge>();
  const flow = buildFlowTree(db, entryId, {
    depth: sequenceDepth(db.node(entryId)),
    maxNodes: options.maxNodes,
    detail: SEQUENCE_WALK_DETAIL,
    edgesOf,
  });
  const sequence = sequenceOf(flow.root, { detail: options.detail, siteOf: sitesFrom(edgesOf), stopOf: stopsIn(db) });
  return { sequence, ...(flow.truncated === undefined ? {} : { truncated: flow.truncated }) };
};
