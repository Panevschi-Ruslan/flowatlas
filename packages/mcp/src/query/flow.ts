import type { DetailLevel, GraphEdge, GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { projectDetail, projectEdge } from './detail.js';
import { truncationMessage, type CompactNode, type FlowNode, type GuardRef } from './types.js';

/**
 * Edges a walk follows outward.
 *
 * A list of edge types rather than a list of node kinds, so a bot callback and
 * a route are walked by exactly the same code. Adding a kind of entry later
 * adds nothing here.
 */
export const FORWARD_EDGES = [
  'handles',
  'calls',
  'queries',
  'caches',
  'emits',
  'consumes',
  'http_calls',
  'hits',
  'triggers',
  'reads_config',
] as const;

/** Collected on the node they protect, never descended into. */
const GUARD_EDGE = 'guarded_by';

/**
 * Edges a walk follows backward, when asking who reaches something.
 *
 * The same list read the other way round, which is the only list that answers
 * the question. It used to leave out `emits`, `queries` and `reads_config`, and
 * each omission was a question the tool could not answer: what publishes to the
 * channel this handler is on, what would break if this table changed, who reads
 * this setting. A walk that stops at a channel says the publisher is not in the
 * blast radius, which is the opposite of true.
 *
 * Widening it cannot make an ordinary walk larger. Only `calls`, `handles` and
 * `triggers` ever point at a method, so the added types change nothing until the
 * walk starts at, or arrives at, one of the nodes that used to be a dead end.
 */
export const REVERSE_EDGES = FORWARD_EDGES;

/** How many hops a walk follows when nobody says. */
export const DEFAULT_FLOW_DEPTH = 8;

/**
 * How far a walk from an entry goes when nobody says how far.
 *
 * Eight hops is a request through a controller, a service and a repository,
 * with room to spare. An entry that is a chain of steps is not: every step is
 * a hop, and a workflow of a dozen steps would be cut off before its last one,
 * never mind the handlers its steps invoke. So an entry that says how many
 * steps it holds (`meta.states`) is walked one hop per step - the longest way
 * through without going round a loop visits each step once - and the usual
 * eight beyond that, into whatever the deepest step reaches. Nothing else is
 * walked further, and `maxNodes` still bounds what is returned (I9).
 */
export const defaultFlowDepth = (entry: GraphNode | undefined): number => {
  const steps = entry?.meta?.['states'];
  return typeof steps === 'number' && Number.isInteger(steps) && steps > 0 ? DEFAULT_FLOW_DEPTH + steps : DEFAULT_FLOW_DEPTH;
};

export interface FlowOptions {
  /** Hops to follow; `defaultFlowDepth` of the entry when absent. */
  depth?: number;
  maxNodes?: number;
  detail?: DetailLevel;
}

export interface FlowResult {
  root: FlowNode;
  unresolvedOnPath: number;
  truncated?: string;
}

/** How many edges may be looked at before the exact overflow count is given up. */
const SCAN_FACTOR = 4;

const orderOf = (edge: GraphEdge): number => {
  const order = edge.meta?.['order'];
  return typeof order === 'number' ? order : Number.MAX_SAFE_INTEGER;
};

const hasOrder = (edge: GraphEdge): boolean => typeof edge.meta?.['order'] === 'number';

/**
 * The order a node's edges are walked in: what it does itself, as written - by
 * line, then by target - and then where control goes next, in the order the
 * edges say it goes there.
 *
 * An edge carries `meta.order` where the order things happen in is not the
 * order they are written in: a state's transitions, whose `Catch` may be
 * written above its `Next` and is still the way out taken last, and every one
 * of which leaves after the task the state runs. Line order would put the
 * catch first and could put the task after both.
 */
const inCallOrder = (a: GraphEdge, b: GraphEdge): number =>
  Number(hasOrder(a)) - Number(hasOrder(b)) ||
  (hasOrder(a) ? orderOf(a) - orderOf(b) : 0) ||
  (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER) ||
  (a.to < b.to ? -1 : a.to > b.to ? 1 : 0);

const guardsOf = (db: GraphDb, id: string, detail: DetailLevel): GuardRef[] =>
  db
    .edgesFrom(id, [GUARD_EDGE])
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((edge, index) => {
      const node = db.node(edge.to);
      return {
        id: edge.to,
        label: node?.label ?? edge.to,
        kind: String(edge.meta?.['kind'] ?? node?.kind ?? 'guard'),
        order: orderOf(edge) === Number.MAX_SAFE_INTEGER ? index : orderOf(edge),
        ...(detail >= 2 && node?.file !== undefined ? { loc: `${node.file}:${node.line ?? 0}` } : {}),
      };
    });

/** A node the graph promised but does not hold, which is a gap worth showing. */
const missingNode = (id: string): CompactNode => ({ id, type: 'missing', label: id });

interface Pending {
  /** Absent once the budget is spent: the walk goes on, only to count. */
  flow: FlowNode | undefined;
  id: string;
  path: ReadonlySet<string>;
  level: number;
}

/**
 * Walks outward from an entry and builds the tree of what it reaches.
 *
 * Breadth first on purpose: a shallow complete picture is worth more to a
 * reader than one deep branch and nothing else, and the cut, when there is one,
 * says exactly how much was left.
 *
 * A node already on the path is emitted once as a bare reference rather than
 * followed, so a cycle ends the branch instead of the walk.
 */
export const buildFlowTree = (db: GraphDb, entryId: string, options: FlowOptions = {}): FlowResult => {
  const start = db.node(entryId);
  const depth = options.depth ?? defaultFlowDepth(start);
  const maxNodes = options.maxNodes ?? 150;
  const detail = options.detail ?? 1;

  const root: FlowNode = {
    node: start === undefined ? missingNode(entryId) : projectDetail(start, detail),
    children: [],
  };
  const rootGuards = guardsOf(db, entryId, detail);
  if (rootGuards.length > 0) root.guards = rootGuards;

  const unresolvedIds = new Set<string>();
  if (db.unresolvedFor(entryId).length > 0) unresolvedIds.add(entryId);

  let used = 1;
  let scanned = 0;
  let overflow = 0;
  const scanLimit = maxNodes * SCAN_FACTOR;

  const queue: Pending[] = [{ flow: root, id: entryId, path: new Set([entryId]), level: 0 }];

  while (queue.length > 0) {
    const item = queue.shift() as Pending;
    if (item.level >= depth) continue;

    for (const edge of db.edgesFrom(item.id, FORWARD_EDGES).sort(inCallOrder)) {
      scanned += 1;
      if (scanned > scanLimit) {
        overflow += 1;
        continue;
      }

      // Past the budget the walk keeps going without building anything, so the
      // number it reports at the end is the number actually left out.
      const room = item.flow !== undefined && used < maxNodes;
      if (!room) overflow += 1;

      if (item.path.has(edge.to)) {
        if (room) {
          used += 1;
          item.flow?.children.push({
            node: { id: edge.to, type: 'ref', label: edge.to, ref: true },
            edge: projectEdge(edge, detail),
            children: [],
          });
        }
        continue;
      }

      const target = db.node(edge.to);
      let child: FlowNode | undefined;
      if (room) {
        if (target === undefined) unresolvedIds.add(edge.to);
        else if (db.unresolvedFor(edge.to).length > 0) unresolvedIds.add(edge.to);

        child = {
          node: target === undefined ? missingNode(edge.to) : projectDetail(target, detail),
          edge: projectEdge(edge, detail),
          children: [],
        };
        const guards = guardsOf(db, edge.to, detail);
        if (guards.length > 0) child.guards = guards;

        used += 1;
        item.flow?.children.push(child);
      }

      queue.push({
        flow: child,
        id: edge.to,
        path: new Set([...item.path, edge.to]),
        level: item.level + 1,
      });
    }
  }

  const result: FlowResult = { root, unresolvedOnPath: unresolvedIds.size };
  if (overflow > 0) result.truncated = truncationMessage(overflow, scanned <= scanLimit);
  return result;
};

/** Every node in a tree, for a caller that wants a flat view of the same walk. */
export const flatten = (node: FlowNode): FlowNode[] => [
  node,
  ...node.children.flatMap((child) => flatten(child)),
];

export type { GraphNode };
