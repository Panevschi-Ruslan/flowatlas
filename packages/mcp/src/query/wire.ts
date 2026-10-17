import type { CompactNode, FlowNode } from './types.js';

/**
 * A tree as it goes over the wire: each fact said once (P93).
 *
 * The walks build full rows because the terminal and the prompt read them;
 * an assistant reads every byte of the answer, so the tools slim the tree at
 * the edge (D4) and the shapes the CLI renders from stay as they are.
 */

/** A node already on the path, named again: its id, and that it is a repeat. */
export interface RefNode {
  id: string;
  ref: true;
}

/** A row of a slimmed tree: `label` absent where it is the id, `service` where the parent said it. */
export type WireNode = RefNode | (Omit<CompactNode, 'label' | 'ref'> & { label?: string });

export interface WireFlowNode extends Omit<FlowNode, 'node' | 'children'> {
  node: WireNode;
  children: WireFlowNode[];
}

const slimNode = (node: CompactNode, parentService: string | undefined): WireNode => {
  if (node.ref === true) return { id: node.id, ref: true };
  // Key by key, so a slimmed row reads in the order a full one does.
  const slim: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'label' && value === node.id) || (key === 'service' && value === parentService)) continue;
    slim[key] = value;
  }
  return slim as WireNode;
};

/**
 * The tree with a repeat said as `{ id, ref: true }`, a label that is only
 * the id left out, and `service` said where it changes: on the root, and again
 * on the row that crosses into another service. `parentService` is the
 * service of what the rows hang under, for a list of children (who_calls).
 */
export const slimTree = (node: FlowNode, parentService?: string): WireFlowNode => {
  const own = node.node.ref === true ? parentService : (node.node.service ?? parentService);
  const { node: _node, children, ...rest } = node;
  return {
    node: slimNode(node.node, parentService),
    ...rest,
    children: children.map((child) => slimTree(child, own)),
  };
};

/** Every row of a list of subtrees, slimmed under the one parent they share. */
export const slimForest = (nodes: readonly FlowNode[], parentService: string | undefined): WireFlowNode[] =>
  nodes.map((node) => slimTree(node, parentService));
