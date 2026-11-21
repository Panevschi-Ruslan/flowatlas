import { isMessageTypeNode, type GraphEdge, type GraphNode } from '@flowatlas/core';
import {
  deadJudge,
  JUDGED_TYPES,
  methodsByOwner,
  ownerOf,
  VERDICT_ORDER,
  type DeadAnswer,
  type DeadOptions,
  type DeadVerdict,
  type GraphDb,
} from '@flowatlas/linker';
import type { DbHandle } from './db.js';
import { REVERSE_EDGES } from './flow.js';
import { loadObserved } from './observed.js';

/**
 * Whether a row's code runs, and where it is reached from (P364), said on the
 * row so an answer needs no `dead`, `who_calls` or `search` after it.
 *
 * `reach` is the verdict `dead` gives, by the same functions (`deadJudge`):
 * `alive`, `dead`, `unknown`, and `unreached` for `dead`'s `likely-dead` -
 * nothing read reaches it, though a call the reading did not follow may. An
 * `alive` row whose walk back ran to its end and met no way in is
 * `unreached` too: something calls it, but nothing a way in reaches. A site
 * of code `dead` does not judge (a publish, a request) takes the liveliest
 * verdict of the code it is written in.
 *
 * `from` is the nearest way in: the first ways in a walk back from the row
 * meets, a way in not walked past, the row's own service first. `ways` counts
 * them where there are several. The walk is bounded per row and per answer;
 * `walkCut` says a row's walk stopped at its bound (so `ways` is a floor, and
 * a missing `from` means none was met within it), and rows past the answer's
 * bound carry no `from`, which the answer's `left` says.
 */
export type Reach = 'alive' | 'unreached' | 'dead' | 'unknown';

export interface RowReach {
  reach?: Reach;
  from?: string;
  ways?: number;
  walkCut?: true;
}

const REACH_OF: Readonly<Record<DeadVerdict, Reach>> = { alive: 'alive', 'likely-dead': 'unreached', dead: 'dead', unknown: 'unknown' };

/** The most nodes one row's walk back reads. */
export const ROW_WALK = 300;
/** The most nodes all the walks of one answer read. */
export const ANSWER_WALK = 20000;
/** The most rows one answer judges. */
export const MAX_JUDGED = 400;

/**
 * The rules the CLI's `dead` reads from the configuration, read the same way
 * so the two agree, and the observed file beside the database when there is
 * one: traffic is evidence for every verdict (P110), over all it holds.
 */
export const deadOptionsOf = (handle: Pick<DbHandle, 'config'> & { path?: string }, service?: string): DeadOptions => {
  const publicRoutes = handle.config?.doctor?.publicRoutes ?? [];
  const infrastructure = handle.config?.dead?.infrastructure;
  const observed = handle.path === undefined ? undefined : loadObserved(handle.path);
  return {
    ...(service === undefined ? {} : { service }),
    ...(publicRoutes.length === 0 ? {} : { publicRoutes }),
    ...(infrastructure === undefined ? {} : { infrastructure }),
    ...(observed === undefined ? {} : { observed }),
  };
};

/** The edges that run the code a site is written in: a call, a route or action handing it work. */
const SITE_CALLERS = ['calls', 'handles'] as const;

const CLASS_TYPES = new Set(['provider', 'ui_component']);

/** A way in as `from` says it: `GET /orders/:param`, `screen /floor-plan`, `cron nightly`, `consumer tenant:*:events`. */
export const wayInSaid = (db: GraphReads, node: GraphNode, rowService: string | undefined): string => {
  let said: string;
  if (node.type === 'consumer') {
    const channel = db.edgesTo(node.id, ['consumes']).map((edge) => db.node(edge.from)?.label ?? edge.from)[0];
    said = `consumer ${channel ?? node.label}`;
  } else {
    const kind = node.kind;
    said = kind === undefined || kind === 'http' || node.label.startsWith(`${kind} `) ? node.label : `${kind} ${node.label}`;
  }
  return node.repo !== '' && rowService !== undefined && node.repo !== rowService ? `${said} (${node.repo})` : said;
};

/** The part of the graph the walks of one answer read, each node and each node's edges read once. */
type GraphReads = Pick<GraphDb, 'node' | 'edgesTo' | 'edgesFrom'>;

/** Walks of many rows meet the same nodes again: what they read is kept for the answer. */
const readOnce = (db: GraphDb): GraphReads => {
  const nodes = new Map<string, GraphNode | undefined>();
  const into = new Map<string, GraphEdge[]>();
  const out = new Map<string, GraphEdge[]>();
  const typed = (edges: GraphEdge[], types?: readonly string[]): GraphEdge[] =>
    types === undefined || types.length === 0 ? edges : edges.filter((edge) => types.includes(edge.type));
  return {
    node: (id) => {
      if (!nodes.has(id)) nodes.set(id, db.node(id));
      return nodes.get(id);
    },
    edgesTo: (id, types) => {
      if (!into.has(id)) into.set(id, db.edgesTo(id));
      return typed(into.get(id)!, types);
    },
    edgesFrom: (id, types) => {
      if (!out.has(id)) out.set(id, db.edgesFrom(id));
      return typed(out.get(id)!, types);
    },
  };
};

/** A consumer nothing read publishes to is opened from outside the graph: a way in of its own. */
const isOutsideConsumer = (graph: GraphReads, node: GraphNode): boolean =>
  node.type === 'consumer' && graph.edgesTo(node.id, ['consumes']).every((edge) => graph.edgesTo(edge.from, ['emits']).length === 0);

interface Walked {
  found: Array<{ node: GraphNode; depth: number }>;
  read: number;
  cut: boolean;
}

export interface ReachReader {
  /** The reach of one node, or nothing for a node the graph does not hold. */
  of(id: string): RowReach;
  /** A row with its reach after its own fields, at detail 1 and up. */
  annotate<T extends { id?: string }>(row: T): T & RowReach;
  /** What was not computed, for the answer's `left`. */
  left(): string[];
}

/**
 * A reader of reach for one answer: verdicts and walks share what they read
 * of the whole graph, each row is computed once, and the bounds above hold
 * however many rows the answer has.
 */
export const reachReader = (db: GraphDb, handle: Pick<DbHandle, 'config'> & { path?: string }, detail: number): ReachReader => {
  const judge = deadJudge(db, db.report(), deadOptionsOf(handle));
  const graph = readOnce(db);
  const verdicts = new Map<string, DeadAnswer | undefined>();
  const verdictOf = (id: string): DeadAnswer | undefined => {
    if (!verdicts.has(id)) verdicts.set(id, judge(id));
    return verdicts.get(id);
  };
  let owners: Map<string, string[]> | undefined;
  const methodsOfClass = (id: string): string[] => (owners ??= methodsByOwner(db)).get(id) ?? [];
  let componentsByFile: Map<string, GraphNode[]> | undefined;
  const componentsIn = (repo: string, file: string | undefined): GraphNode[] => {
    if (file === undefined) return [];
    if (componentsByFile === undefined) {
      componentsByFile = new Map();
      for (const component of db.nodesByType('ui_component')) {
        if (component.file === undefined) continue;
        const key = `${component.repo}\u0000${component.file}`;
        componentsByFile.set(key, [...(componentsByFile.get(key) ?? []), component]);
      }
    }
    return componentsByFile.get(`${repo}\u0000${file}`) ?? [];
  };

  let budget = ANSWER_WALK;
  let judged = 0;
  let unjudged = 0;
  let unwalked = 0;
  const done = new Map<string, RowReach>();

  /**
   * Back from a node to the first ways in on each path. Beside the edges
   * every caller walk follows, the hops that place code in what holds it: a
   * consumer runs in its handler, a component's method runs where the
   * component is shown, a handler's class is built where it is injected, and
   * a template's action belongs to its file's component.
   */
  const walk = (start: GraphNode): Walked => {
    const limit = Math.min(ROW_WALK, budget);
    const seen = new Set<string>([start.id]);
    const found: Walked['found'] = [];
    // A handler a consumer runs is held as the consumer's is: where its class or file is shown.
    const handler = graph.edgesTo(start.id, ['handles']).some((edge) => edge.from.startsWith('consumer:'));
    const queue: Array<{ node: GraphNode; depth: number; held: boolean }> = [{ node: start, depth: 0, held: handler }];
    if (CLASS_TYPES.has(start.type)) {
      for (const method of methodsOfClass(start.id)) {
        const node = graph.node(method);
        if (node === undefined || seen.has(method)) continue;
        seen.add(method);
        queue.push({ node, depth: 1, held: false });
      }
    }
    let read = 0;
    let cut = false;
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (read >= limit) {
        cut = true;
        break;
      }
      read += 1;
      const { node, depth } = item;
      if (node.id !== start.id && (node.type === 'entry' || isOutsideConsumer(graph, node))) {
        found.push({ node, depth });
        continue;
      }
      // A consumer runs where its handler is held: the request that opened its
      // stream is shared by every screen that opens one, so it says nothing of which.
      const handlers = node.type === 'consumer' ? graph.edgesFrom(node.id, ['handles']) : [];
      let into = graph.edgesTo(node.id, REVERSE_EDGES).filter((edge) => handlers.length === 0 || edge.type !== 'triggers');
      // A consumer that chooses by type runs on the types it selects, not on every publish of their channel.
      const typed = node.type === 'consumer' ? into.filter((edge) => edge.type === 'consumes' && isMessageTypeNode(graph.node(edge.from))) : [];
      if (typed.length > 0) into = into.filter((edge) => edge.type !== 'consumes' || typed.includes(edge));
      const next: Array<{ id: string; held: boolean }> = into.map((edge) => ({ id: edge.from, held: false }));
      for (const edge of handlers) next.push({ id: edge.to, held: true });
      if (node.type === 'method' || node.type === 'function') {
        const owner = ownerOf(node.id);
        const holder = owner === undefined ? undefined : graph.node(owner);
        if (holder !== undefined && (holder.type === 'ui_component' || item.held)) next.push({ id: holder.id, held: true });
      }
      if (CLASS_TYPES.has(node.type) && (item.held || node.id === start.id)) {
        for (const edge of graph.edgesTo(node.id, ['injects'])) next.push({ id: edge.from, held: true });
      }
      if (node.type === 'ui_component') {
        for (const edge of graph.edgesTo(node.id, ['imports'])) {
          if (graph.node(edge.from)?.type === 'ui_component') next.push({ id: edge.from, held: true });
        }
      }
      // A template's action, and a module's function a consumer runs, belong to the components of their file.
      if (node.type === 'ui_action' || (node.type === 'function' && item.held)) {
        for (const component of componentsIn(node.repo, node.file)) next.push({ id: component.id, held: true });
      }
      for (const step of next) {
        if (seen.has(step.id)) continue;
        seen.add(step.id);
        const reached = graph.node(step.id);
        if (reached !== undefined) queue.push({ node: reached, depth: depth + 1, held: step.held });
      }
    }
    budget -= read;
    return { found, read, cut };
  };

  /** The verdict of a node `dead` judges, or the liveliest of the code a site is written in. */
  const reachOf = (node: GraphNode): Reach | undefined => {
    if (JUDGED_TYPES.includes(node.type)) {
      const answer = verdictOf(node.id);
      return answer === undefined ? undefined : REACH_OF[answer.verdict];
    }
    let best: DeadVerdict | undefined;
    for (const edge of graph.edgesTo(node.id, SITE_CALLERS)) {
      const caller = graph.node(edge.from);
      if (caller === undefined || !JUDGED_TYPES.includes(caller.type)) continue;
      const verdict = verdictOf(caller.id)?.verdict;
      if (verdict !== undefined && (best === undefined || VERDICT_ORDER[verdict] > VERDICT_ORDER[best])) best = verdict;
    }
    return best === undefined ? undefined : REACH_OF[best];
  };

  const of = (id: string): RowReach => {
    const known = done.get(id);
    if (known !== undefined) return known;
    const node = graph.node(id);
    if (node === undefined) return {};
    if (judged >= MAX_JUDGED) {
      unjudged += 1;
      return {};
    }
    judged += 1;
    const reach = reachOf(node);
    let row: RowReach = reach === undefined ? {} : { reach };
    // A way in is its own; only code below one is walked back from.
    if (node.type !== 'entry' && reach !== undefined) {
      if (budget <= 0) unwalked += 1;
      else {
        const walked = walk(node);
        const own = walked.found.filter((way) => way.node.repo === node.repo);
        const pool = own.length > 0 ? own : walked.found;
        const nearest = [...pool].sort((a, b) => a.depth - b.depth || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0))[0];
        const ways = new Set(walked.found.map((way) => way.node.id)).size;
        const nowhere = nearest === undefined && !walked.cut;
        row = {
          ...row,
          ...(nowhere && reach === 'alive' ? { reach: 'unreached' as const } : {}),
          ...(nearest === undefined ? (walked.cut ? {} : { from: 'none' }) : { from: wayInSaid(graph, nearest.node, node.repo === '' ? undefined : node.repo) }),
          ...(ways > 1 ? { ways } : {}),
          ...(walked.cut ? { walkCut: true as const } : {}),
        };
      }
    }
    done.set(id, row);
    return row;
  };

  return {
    of,
    annotate: (row) => (detail < 1 || row.id === undefined ? (row as typeof row & RowReach) : { ...row, ...of(row.id) }),
    left: () => [
      ...(unjudged === 0 ? [] : [`reach: not computed for ${unjudged} row${unjudged === 1 ? '' : 's'} past ${MAX_JUDGED}`]),
      ...(unwalked === 0 ? [] : [`from: not walked for ${unwalked} row${unwalked === 1 ? '' : 's'} past ${ANSWER_WALK} nodes read`]),
    ],
  };
};

/** Rows of a tree, nearest first: each row's node, then its children's, breadth first. */
export const annotateTree = <T extends { node: { id: string; ref?: true }; children: T[] }>(roots: readonly T[], reader: ReachReader): void => {
  const queue = [...roots];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.node.ref !== true) Object.assign(item.node, reader.annotate({ id: item.node.id }));
    queue.push(...item.children);
  }
};
