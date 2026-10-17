import { accessOf, STEP_OF_META, STEPS_META, TAKEN_BY_META, type DetailLevel, type GraphEdge, type GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { projectDetail, projectEdge } from './detail.js';
import { failsOf } from './fails.js';
import { MinHeap } from './heap.js';
import { truncationMessage, type CompactNode, type FlowNode, type GuardRef, type OptOutRef, type WalkLimit } from './types.js';
import { slimTree } from './wire.js';

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

/** The steps a node that starts a chain says the chain holds (`STEPS_META`), or none. */
const stepsOf = (node: Pick<GraphNode, 'meta'> | undefined): number => {
  const steps = node?.meta?.[STEPS_META];
  return typeof steps === 'number' && Number.isInteger(steps) && steps > 0 ? steps : 0;
};

/** Whether a node is one step of a chain (`STEP_OF_META`). */
const isStep = (node: Pick<GraphNode, 'meta'>): boolean => node.meta?.[STEP_OF_META] !== undefined;

/**
 * How far a walk from an entry goes when nobody says how far.
 *
 * Eight hops is a request through a controller, a service and a repository,
 * with room to spare. An entry that is a chain of steps is not: every step is
 * a hop, and a workflow of a dozen steps would be cut off before its last one,
 * never mind the handlers its steps invoke. So an entry that says how many
 * steps it holds (`STEPS_META`) is walked one hop per step - the longest way
 * through without going round a loop visits each step once - and the usual
 * eight beyond that, into whatever the deepest step reaches. Nothing else is
 * walked further, and `maxNodes` still bounds what is returned (I9).
 */
export const defaultFlowDepth = (entry: GraphNode | undefined): number => DEFAULT_FLOW_DEPTH + stepsOf(entry);

/**
 * How far a walk back towards the ways in goes when nobody says: the same rule,
 * read the other way round.
 *
 * A walk down from a chain of steps is lengthened by the steps the chain holds,
 * because it knows them before it starts. A walk back up from a handler does not:
 * it arrives at a chain at whichever step reaches the handler and climbs from
 * there, one hop per step, and the start that says how many steps there are is
 * at the top of the climb, perhaps past where an unlengthened walk stops. So a
 * walk back is lengthened by the steps it climbs (`STEP_OF_META`), each counted
 * once however many paths reach it: it is walked again, further, whenever it
 * climbed steps it was not lengthened for, until it climbs no new one. A longer
 * walk reaches everything a shorter one did and a graph has so many steps, so
 * this ends; and each walk is still bounded by its node limit (I9).
 *
 * `walk` takes a depth and returns what it reached; `base` is the depth a walk
 * through no chain goes.
 */
export const walkBack = <T extends { readonly rows: readonly Pick<GraphNode, 'id' | 'meta'>[] }>(
  base: number,
  walk: (depth: number) => T,
): T => {
  let depth = base;
  for (;;) {
    const result = walk(depth);
    const needed = base + new Set(result.rows.filter(isStep).map((row) => row.id)).size;
    if (needed <= depth) return result;
    depth = needed;
  }
};

export interface FlowOptions {
  /** Hops to follow; `defaultFlowDepth` of the entry when absent. */
  depth?: number;
  maxNodes?: number;
  /**
   * About the most characters the answer may take, each row measured as it is
   * added, in the form it goes over the wire (P92). No ceiling when absent: the
   * terminal pages its own output.
   */
  maxChars?: number;
  detail?: DetailLevel;
}

/** A crossing the walk reached and did not follow, so it can be asked about directly (P92). */
export interface CrossingLeft {
  from: string;
  to: string;
  type: string;
  service?: string;
}

export interface FlowResult {
  root: FlowNode;
  unresolvedOnPath: number;
  truncated?: string;
  /** The limits that left rows out, the one that left out more first (P92). */
  stoppedBy?: WalkLimit[];
  /** How many rows they left out between them. */
  left?: number;
  /** The crossings left unfollowed, nearest first, at most `MAX_CROSSINGS_LEFT`. */
  crossingsLeft?: CrossingLeft[];
}

/** How many nodes a walk shows when nobody says; `get_flow` sets its own (P92 D4). */
export const DEFAULT_WALK_NODES = 150;

/** How many edges may be looked at before the exact overflow count is given up. */
const SCAN_FACTOR = 4;

/**
 * Edges that leave the method they start in for somewhere else: another
 * service, a data store, a channel, the next step of a chain (P92). A walk
 * spends its budget on them first, because the step that crosses is the one
 * the question is usually about.
 */
export const CROSSING_EDGES = ['http_calls', 'hits', 'emits', 'consumes', 'queries', 'caches', 'triggers'] as const;

/** A method called from more than this many methods is plumbing, for the budget (P92 D3). */
export const PLUMBING_FAN_IN = 5;

/** How many unfollowed crossings an answer names. */
export const MAX_CROSSINGS_LEFT = 8;

/** What an answer holds beside its tree - the counts, the cut, `next` - so `maxChars` is of the whole answer. */
const ANSWER_OVERHEAD = 600;

/** The crossings that leave the service: a request, a publish, a hand-off to another way in. */
const LEAVING_EDGES = new Set(['http_calls', 'hits', 'emits', 'consumes', 'triggers']);

/**
 * Nodes a call reaches on its way out of a method: the request, the publish,
 * another way in. A call into one ranks as the crossing it leads to, or the
 * budget would be spent before the `http_calls` beneath it.
 */
const LEAVING_NODES = new Set(['http_out', 'producer', 'consumer', 'ui_api_call', 'channel', 'external_api', 'entry']);

/** The crossings that reach a store, and the nodes on the way to one. */
const STORE_EDGES = new Set(['queries', 'caches']);
const STORE_NODES = new Set(['db_query', 'cache_op', 'table']);

/**
 * What a step is worth the budget, the least first (P92 D2): a crossing out of
 * the service, a store, the handler a way in hands to, a call into a method
 * that itself leaves the service (one hop of lookahead), any other call, and
 * plumbing - a method more than `PLUMBING_FAN_IN` other methods call, and
 * whatever it calls in turn. Under plumbing only a crossing ranks higher again,
 * so a shared HTTP client's request still gets room before a logger's
 * internals do.
 */
const RANK = { out: 0, store: 1, handles: 2, toward: 3, calls: 4, plumbing: 5 } as const;
type Rank = (typeof RANK)[keyof typeof RANK];

const crossingRank = (edge: GraphEdge, target: GraphNode | undefined): Rank | undefined =>
  LEAVING_EDGES.has(edge.type) || (target !== undefined && LEAVING_NODES.has(target.type))
    ? RANK.out
    : STORE_EDGES.has(edge.type) || (target !== undefined && STORE_NODES.has(target.type))
      ? RANK.store
      : undefined;

/** Whether a rank is one of the crossings, the steps `crossingsLeft` names. */
const isCrossing = (rank: Rank): boolean => rank === RANK.out || rank === RANK.store;

/** What the walk reads off the graph to rank a step, each once per walk (D3). */
interface Ranking {
  fanIn: (id: string) => number;
  leavesFrom: (id: string) => boolean;
}

const rankOf = (edge: GraphEdge, target: GraphNode | undefined, under: Rank, ranking: Ranking): Rank => {
  const crossing = crossingRank(edge, target);
  if (crossing !== undefined) return crossing;
  if (under === RANK.plumbing) return RANK.plumbing;
  if (edge.type === 'handles') return RANK.handles;
  if (edge.type !== 'calls') return RANK.calls;
  if (ranking.leavesFrom(edge.to)) return RANK.toward;
  return ranking.fanIn(edge.to) > PLUMBING_FAN_IN ? RANK.plumbing : RANK.calls;
};

/** Read from the graph once per walk and never stored: who calls a node, and whether it leaves the service itself. */
const rankingFor = (db: GraphDb): Ranking => {
  const fanIns = new Map<string, number>();
  const leaves = new Map<string, boolean>();
  return {
    fanIn: (id) => {
      let count = fanIns.get(id);
      if (count === undefined) {
        count = new Set(db.edgesTo(id, ['calls']).map((edge) => edge.from)).size;
        fanIns.set(id, count);
      }
      return count;
    },
    leavesFrom: (id) => {
      let found = leaves.get(id);
      if (found === undefined) {
        found = db.edgesFrom(id, FORWARD_EDGES).some((edge) => crossingRank(edge, db.node(edge.to)) === RANK.out);
        leaves.set(id, found);
      }
      return found;
    },
  };
};

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

const guardsOf = (db: GraphDb, id: string, detail: DetailLevel): GuardRef[] => {
  // Where each check was put, as the reader of the framework wrote it on the
  // entry (P76); matched on the node the edge points at.
  const said = new Map((accessOf(db.node(id))?.guards ?? []).map((guard) => [guard.id, guard]));
  return db
    .edgesFrom(id, [GUARD_EDGE])
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((edge, index) => {
      const node = db.node(edge.to);
      const access = said.get(edge.to);
      return {
        id: edge.to,
        label: node?.label ?? edge.to,
        kind: String(edge.meta?.['kind'] ?? node?.kind ?? 'guard'),
        order: orderOf(edge) === Number.MAX_SAFE_INTEGER ? index : orderOf(edge),
        ...(detail >= 2 && node?.file !== undefined ? { loc: `${node.file}:${node.line ?? 0}` } : {}),
        ...(access === undefined ? {} : { where: access.where, via: access.via }),
        ...(access?.skippedBy === undefined ? {} : { skippedBy: access.skippedBy }),
      };
    });
};

/** The opt-outs written on an entry's handler or its class (P76). */
export const optOutsOf = (node: GraphNode | undefined): OptOutRef[] =>
  (accessOf(node)?.optOuts ?? []).map((item) => ({
    decorator: item.decorator,
    ...(item.key === undefined ? {} : { key: item.key }),
    public: item.public,
    skips: item.skips,
    where: item.where,
    ...(item.file === undefined ? {} : { loc: item.line === undefined ? item.file : `${item.file}:${item.line}` }),
  }));

/** A node the graph promised but does not hold, which is a gap worth showing. */
const missingNode = (id: string): CompactNode => ({ id, type: 'missing', label: id });

interface Pending {
  /** Absent once the budget is spent: the walk goes on, only to count. */
  flow: FlowNode | undefined;
  id: string;
  path: ReadonlySet<string>;
  level: number;
  rank: Rank;
  /** When it was queued, so equal ranks keep the order they were reached in. */
  seq: number;
  /** The edge that reached it, to name a crossing the walk did not follow. */
  via?: GraphEdge;
  /**
   * The consumers of the channel this is that take what the publisher the walk
   * came from publishes, where the publisher's edge says (P52): a write to a
   * bucket goes on to the notifications that take it, not to every one.
   */
  takenBy?: ReadonlySet<string>;
}

/** Rows first, then what is only counted; within each, by rank, then nearest, then first reached. */
const expandsFirst = (a: Pending, b: Pending): boolean =>
  (Number(a.flow === undefined) - Number(b.flow === undefined) || a.rank - b.rank || a.level - b.level || a.seq - b.seq) < 0;

const takenByOf = (edge: GraphEdge): ReadonlySet<string> | undefined => {
  const ids = edge.meta?.[TAKEN_BY_META];
  return Array.isArray(ids) ? new Set(ids.map(String)) : undefined;
};

/** The limit that left out more says the sentence; a tie goes to the budget, whose advice is the one to take. */
const BY_WEIGHT: readonly WalkLimit[] = ['maxNodes', 'maxChars', 'depth'];

/**
 * Walks outward from an entry and builds the tree of what it reaches.
 *
 * Each node is expanded once in the whole walk (P92 D1): met again, on another
 * path, it is a reference saying under which row its subtree is (`seenAt`); met
 * on its own path, a cycle, it is a bare reference. A repository helper every
 * method calls is written out once, not once per caller.
 *
 * The budget is spent in priority order (D2): the walk expands next the pending
 * row that crosses into another service, store or channel, then handlers, then
 * calls, and plumbing last, nearest first within a rank; and when a node has
 * more children than room, the crossings get it. The children are still
 * written in call order (P66): priority picks who gets room, not where they go.
 *
 * Two ceilings, rows (`maxNodes`) and characters (`maxChars`), and the depth;
 * whatever any of them leaves out is counted, and the answer names the limit
 * that did it (I9).
 */
export const buildFlowTree = (db: GraphDb, entryId: string, options: FlowOptions = {}): FlowResult => {
  const start = db.node(entryId);
  const depth = options.depth ?? defaultFlowDepth(start);
  const maxNodes = options.maxNodes ?? DEFAULT_WALK_NODES;
  const maxChars = options.maxChars;
  const detail = options.detail ?? 1;

  const root: FlowNode = {
    node: start === undefined ? missingNode(entryId) : projectDetail(start, detail),
    children: [],
  };
  const rootGuards = guardsOf(db, entryId, detail);
  if (rootGuards.length > 0) root.guards = rootGuards;
  const rootFails = failsOf(start, detail);
  if (rootFails.length > 0) root.fails = rootFails;
  const rootOptOuts = optOutsOf(start);
  if (rootOptOuts.length > 0) root.optOuts = rootOptOuts;

  const unresolvedIds = new Set<string>();
  if (db.unresolvedFor(entryId).length > 0) unresolvedIds.add(entryId);

  const ranking = rankingFor(db);

  /** The characters a row adds to the answer, in its wire form, with the comma before it. */
  const sizeOf = (row: FlowNode, parentService: string | undefined): number => JSON.stringify(slimTree(row, parentService)).length + 1;

  const rowOf = (edge: GraphEdge, target: GraphNode | undefined, repeat: 'cycle' | 'again' | undefined, seenAt?: string): FlowNode => {
    if (repeat !== undefined) {
      return {
        node: {
          id: edge.to,
          type: 'ref',
          label: target?.label ?? edge.to,
          ref: true,
          ...(repeat === 'again' && seenAt !== undefined ? { seenAt } : {}),
        },
        edge: projectEdge(edge, detail),
        children: [],
      };
    }
    const row: FlowNode = {
      node: target === undefined ? missingNode(edge.to) : projectDetail(target, detail),
      edge: projectEdge(edge, detail),
      children: [],
    };
    const guards = guardsOf(db, edge.to, detail);
    if (guards.length > 0) row.guards = guards;
    const fails = failsOf(target, detail);
    if (fails.length > 0) row.fails = fails;
    return row;
  };

  /** Where each node's own row is: the id of the row it hangs under. */
  const placed = new Map<string, string>();
  /** Every node given a row or counted, so each is followed once. */
  const reached = new Set<string>([entryId]);
  const cut: Record<WalkLimit, number> = { depth: 0, maxNodes: 0, maxChars: 0 };
  let stopped: 'maxNodes' | 'maxChars' | undefined;
  let depthExact = true;
  let used = 1;
  let scanned = 0;
  let chars = maxChars === undefined ? 0 : JSON.stringify(slimTree(root)).length + ANSWER_OVERHEAD;
  const scanLimit = maxNodes * SCAN_FACTOR;

  // Collected in the order the walk met them, and named out of the service
  // first: a store left unread matters less than a service never reached.
  const crossingsLeft: Array<CrossingLeft & { rank: Rank }> = [];
  const leftKeys = new Set<string>();
  const leave = (edge: GraphEdge, target: GraphNode | undefined, rank: Rank): void => {
    const key = `${edge.from}\n${edge.to}`;
    if (crossingsLeft.length >= MAX_CROSSINGS_LEFT * SCAN_FACTOR || leftKeys.has(key)) return;
    leftKeys.add(key);
    crossingsLeft.push({ from: edge.from, to: edge.to, type: edge.type, ...(target?.repo === undefined ? {} : { service: target.repo }), rank });
  };

  let seq = 0;
  const queue = new MinHeap<Pending>(expandsFirst);
  queue.push({ flow: root, id: entryId, path: new Set([entryId]), level: 0, rank: RANK.out, seq: seq++ });

  while (queue.size > 0) {
    const item = queue.pop() as Pending;
    const edges = db
      .edgesFrom(item.id, FORWARD_EDGES)
      .filter((edge) => !(edge.type === 'consumes' && item.takenBy !== undefined && !item.takenBy.has(edge.to)))
      .sort(inCallOrder);
    if (edges.length === 0) continue;

    // A row on the line the walk was told to stop at: what lies past it is
    // counted for the sentence and not walked, so nothing past the line is on
    // the path (or in `unresolvedOnPath`), as before. A count of rows only
    // counts what is not already somewhere else to be read.
    if (item.level >= depth) {
      if (item.flow === undefined) continue;
      let crossed = false;
      for (const edge of edges) {
        cut.depth += 1;
        if (depthExact && !reached.has(edge.to) && db.edgesFrom(edge.to, FORWARD_EDGES).length > 0) depthExact = false;
        const target = db.node(edge.to);
        const rank = rankOf(edge, target, item.rank, ranking);
        if (!placed.has(edge.to) && isCrossing(rank)) {
          leave(edge, target, rank);
          crossed = true;
        }
      }
      if (!crossed && item.via !== undefined && isCrossing(item.rank)) leave(item.via, db.node(item.id), item.rank);
      continue;
    }

    // The order the room goes in, which is not the order rows are written in.
    const candidates = edges
      .map((edge, order) => {
        const target = db.node(edge.to);
        return { edge, target, order, rank: rankOf(edge, target, item.rank, ranking) };
      })
      .sort((a, b) => a.rank - b.rank || a.order - b.order);

    const rows: Array<{ order: number; row: FlowNode }> = [];
    let cutHere = 0;
    let crossed = false;
    for (const { edge, target, order, rank } of candidates) {
      scanned += 1;
      if (scanned > scanLimit) {
        stopped ??= 'maxNodes';
        cut[stopped] += 1;
        cutHere += 1;
        continue;
      }

      const repeat = item.path.has(edge.to) ? 'cycle' : reached.has(edge.to) ? 'again' : undefined;
      if (repeat === undefined) {
        reached.add(edge.to);
        // Every node the walk reaches is on the path, the ones past the budget
        // and the entry a path ends at included: a function deployed with no body
        // to read is where its path stops, and the row saying so is why (R168).
        if (target === undefined || db.unresolvedFor(edge.to).length > 0) unresolvedIds.add(edge.to);
      }

      let row = item.flow === undefined || stopped !== undefined ? undefined : rowOf(edge, target, repeat, placed.get(edge.to));
      if (row !== undefined && used >= maxNodes) {
        stopped = 'maxNodes';
        row = undefined;
      }
      if (row !== undefined && maxChars !== undefined) {
        const size = sizeOf(row, item.flow?.node.service);
        // The first row is written whatever its size, so an answer is never
        // only its root; the walk stops after it.
        if (chars + size > maxChars && used > 1) {
          stopped = 'maxChars';
          row = undefined;
        } else chars += size;
      }

      if (row === undefined) {
        // Past the budget the walk keeps going without building anything, so the
        // number it reports at the end is the number actually left out.
        cut[stopped ?? 'maxNodes'] += 1;
        cutHere += 1;
        if (item.flow !== undefined && repeat === undefined && isCrossing(rank)) {
          leave(edge, target, rank);
          crossed = true;
        }
        if (repeat === undefined) {
          const takenBy = takenByOf(edge);
          queue.push({
            flow: undefined,
            id: edge.to,
            path: new Set([...item.path, edge.to]),
            level: item.level + 1,
            rank,
            seq: seq++,
            ...(takenBy === undefined ? {} : { takenBy }),
          });
        }
        continue;
      }

      used += 1;
      rows.push({ order, row });
      if (repeat === undefined) {
        placed.set(edge.to, item.id);
        const takenBy = takenByOf(edge);
        queue.push({
          flow: row,
          id: edge.to,
          path: new Set([...item.path, edge.to]),
          level: item.level + 1,
          rank,
          seq: seq++,
          via: edge,
          ...(takenBy === undefined ? {} : { takenBy }),
        });
      }
    }
    item.flow?.children.push(...rows.sort((a, b) => a.order - b.order).map((entry) => entry.row));
    // A crossing whose own row was written and whose way on was not: the
    // crossing itself is what to ask about next.
    if (item.flow !== undefined && cutHere > 0 && !crossed && item.via !== undefined && isCrossing(item.rank)) {
      leave(item.via, db.node(item.id), item.rank);
    }
  }

  const result: FlowResult = { root, unresolvedOnPath: unresolvedIds.size };
  const stoppedBy = BY_WEIGHT.filter((limit) => cut[limit] > 0).sort((a, b) => cut[b] - cut[a]);
  if (stoppedBy.length === 0) return result;

  const first = stoppedBy[0] as WalkLimit;
  const within = scanned <= scanLimit;
  const at = { depth, maxNodes, maxChars: maxChars ?? 0 }[first];
  result.truncated = truncationMessage(cut[first], within && (first !== 'depth' || depthExact), { limit: first, at });
  result.stoppedBy = stoppedBy;
  result.left = stoppedBy.reduce((total, limit) => total + cut[limit], 0);
  if (crossingsLeft.length > 0) {
    result.crossingsLeft = crossingsLeft
      .sort((a, b) => a.rank - b.rank)
      .slice(0, MAX_CROSSINGS_LEFT)
      .map(({ rank: _rank, ...left }) => left);
  }
  return result;
};

/** Every node in a tree, for a caller that wants a flat view of the same walk. */
export const flatten = (node: FlowNode): FlowNode[] => [
  node,
  ...node.children.flatMap((child) => flatten(child)),
];

export type { GraphNode };
