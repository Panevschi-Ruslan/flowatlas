/**
 * The shapes `fixture-nodes.mjs` works with, declared structurally.
 *
 * Structurally rather than by importing `@flowatlas/core`, because this
 * resolver is read by the command-line tests, by the server tests, by the
 * snapshot script and by the recorded demos, and only two of those are
 * TypeScript. A graph read back from `project-graph.json` satisfies this as
 * readily as one a test just built in memory, which is the whole point.
 */

export interface FixtureNode {
  id: string;
  type: string;
  repo?: string;
  file?: string;
  line?: number;
  kind?: string;
  meta?: Record<string, unknown>;
}

export interface FixtureEdge {
  from: string;
  to: string;
  type: string;
}

export interface FixtureGraph {
  nodes: readonly FixtureNode[];
  edges: readonly FixtureEdge[];
}

/**
 * A node type and exactly one relation: what the thing is, and what it hangs
 * off. `calledBy` and `cachedBy` name the enclosing function or method;
 * `handling` names the method a click or a submit hands control to.
 */
export type NodeSelector =
  | { type: string; calledBy: string }
  | { type: string; cachedBy: string }
  | { type: string; handling: string };

export declare const RELATION_NAMES: string[];

export declare const readGraphFile: (path: string) => FixtureGraph;

export declare const resolveNode: (graph: FixtureGraph, selector: NodeSelector) => FixtureNode;

export declare const resolveNodeId: (graph: FixtureGraph, selector: NodeSelector) => string;
