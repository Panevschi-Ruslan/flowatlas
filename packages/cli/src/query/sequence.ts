import { wasMissed, type GraphEdge } from '@flowatlas/core';
import { DEFAULT_BLAST_DEPTH, sequenceOf, siteOfEdge, type GraphDb, type Sequence, type SequenceDetail, type SequenceSite } from '@flowatlas/linker';
import { buildFlowTree, defaultFlowDepth, type FlowNode } from '@flowatlas/mcp';

/**
 * Why a walk cannot see past a row, read off the graph (P116): the reason of
 * the first gap row recorded against its node, by line. A note says how a join
 * was made and a finding says something about the code, so neither is a stop;
 * nor is a row at `nothing`, which has no edge to draw (`wasMissed`).
 */
export const stopsIn =
  (db: GraphDb) =>
  (row: Pick<FlowNode, 'node'>): string | undefined =>
    db
      .unresolvedFor(row.node.id)
      .filter((item) => wasMissed(item))
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0))[0]?.reason;

/** The site of the graph edge behind each row, from the map a walk fills (`FlowOptions.edgesOf`). */
export const sitesFrom =
  (edges: ReadonlyMap<FlowNode, GraphEdge>) =>
  (row: FlowNode): SequenceSite | undefined => {
    const edge = edges.get(row);
    return edge === undefined ? undefined : siteOfEdge(edge);
  };

/**
 * The detail a sequence is walked at, whatever was asked for: a participant
 * label reads a channel's kind (`meta`), and `flow --format sequence` must draw
 * the diagram `diff` draws (I7: read at render, nothing stored).
 */
export const SEQUENCE_WALK_DETAIL = 2;

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
