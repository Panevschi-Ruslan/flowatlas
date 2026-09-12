import type { CompactNode, FlowNode } from '@flowatlas/mcp';

export interface Link {
  source: string;
  target: string;
  type: string;
  confidence: string;
}

export interface FlatGraph {
  nodes: CompactNode[];
  links: Link[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The tree, flattened back into the graph it was cut from.
 *
 * A node two branches lead to is one node here, which is what a drawing wants:
 * the tree shape exists to be read top to bottom, and a picture would rather
 * show the join. Guards become nodes of their own, since a diagram that hides
 * what runs before a handler is telling half the story.
 */
export const graphOf = (tree: FlowNode): FlatGraph => {
  const nodes = new Map<string, CompactNode>();
  const links = new Map<string, Link>();

  const remember = (node: CompactNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const join = (source: string, target: string, type: string, confidence: string): void => {
    const key = `${source}\0${target}\0${type}`;
    if (!links.has(key)) links.set(key, { source, target, type, confidence });
  };

  const visit = (flow: FlowNode, parent: string | undefined): void => {
    remember(flow.node);
    if (parent !== undefined && flow.edge !== undefined) {
      join(parent, flow.node.id, flow.edge.type, flow.edge.confidence);
    } else if (parent !== undefined) {
      join(parent, flow.node.id, 'contains', 'static');
    }
    for (const guard of flow.guards ?? []) {
      remember({ id: guard.id, type: guard.kind, label: guard.label });
      join(flow.node.id, guard.id, 'guarded_by', 'static');
    }
    for (const child of flow.children) visit(child, flow.node.id);
  };

  visit(tree, undefined);

  return {
    nodes: [...nodes.values()].sort((a, b) => cmp(a.id, b.id)),
    links: [...links.values()].sort(
      (a, b) => cmp(a.source, b.source) || cmp(a.target, b.target) || cmp(a.type, b.type),
    ),
  };
};
