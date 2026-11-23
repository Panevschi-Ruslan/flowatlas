import {
  gapIdOf,
  isMessageTypeNode,
  isRunsBeforeEdge,
  NAVIGATES_META,
  recordsFollowCause,
  wasMissed,
  type GraphEdge,
  type GraphNode,
} from '@flowatlas/core';
import {
  deadJudge,
  JUDGED_TYPES,
  methodsByOwner,
  ownerOf,
  VERDICT_ORDER,
  type DeadAnswer,
  type DeadOptions,
  type GraphDb,
} from '@flowatlas/linker';
import type { DbHandle } from './db.js';
import { REVERSE_EDGES } from './flow.js';
import { loadObserved } from './observed.js';

/**
 * Whether a row's code runs, and where it is reached from (P364), said on the
 * row so an answer needs no `dead`, `who_calls` or `search` after it; and
 * never a maybe said as a no (P367).
 *
 * `reach` is read off the verdict `dead` gives, by the same functions
 * (`deadJudge`):
 *
 * - `alive`: a way in reaches it.
 * - `maybe`: `dead`'s `likely-dead`, or nothing read reaches it but a call the
 *   reading did not follow could: a walk back from the row ends at code
 *   nothing read calls, in a file with an unread call or judged `likely-dead`
 *   itself. The row names it: `gap`, the unread call's gap id, and `behind`,
 *   the code the chain stops at (or, for the row itself, why it may still be
 *   called).
 * - `unreached`: no way in reaches it, and no unread call could: nothing read
 *   reaches it, or `dead` says `likely-dead` of code whose name its
 *   repository writes nowhere else (`unreferenced`, P370) in a file with no
 *   unread call - an unread call writes the name it calls.
 * - `dead`: as `dead` answers.
 * - `outside`: something outside the project calls it - a webhook, a bot
 *   update or command, a cron, a screen opened at its address, a public
 *   route. A way in is never doubtful just because its caller is outside.
 *
 * A site of code `dead` does not judge (a publish, a request) takes the
 * liveliest verdict of the code it is written in.
 *
 * `from` is the nearest way in: the first ways in a walk back from the row
 * meets, a way in not walked past, the row's own service first; on a `maybe`
 * row nothing read reaches, the nearest way in beyond the unread call where
 * one is known (a walk back from the code the call is written in), and
 * `behind` otherwise. `ways` counts them where there are several. The walk is
 * bounded per row and per answer; `walkCut` says a row's walk stopped at its
 * bound (so `ways` is a floor, and a missing `from` means none was met within
 * it), and rows past the answer's bound carry no `from`, which the answer's
 * `left` says.
 */
export type Reach = 'alive' | 'maybe' | 'unreached' | 'dead' | 'outside';

export const REACHES: readonly Reach[] = ['alive', 'maybe', 'unreached', 'dead', 'outside'];

export interface RowReach {
  reach?: Reach;
  from?: string;
  ways?: number;
  walkCut?: true;
  /** On a `maybe` row: the gap id of the unread call that could reach it. */
  gap?: string;
  /** On a `maybe` row: the code its chain stops at, or why the row itself may still be called. */
  behind?: string;
}

/** What `from` says on a `maybe` row when no way in beyond the unread call is known. */
export const FROM_BEHIND = 'behind';

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

/**
 * A verdict as `reach` says it (P367). `unknown` is never said: with what is
 * outside named (a kind of way in, an infrastructure role, a stream, a
 * library), or on a way in nothing reaches with no call one segment off, the
 * caller is outside the project; otherwise an unread call could reach it.
 */
export const reachOfVerdict = (node: Pick<GraphNode, 'type'>, answer: Pick<DeadAnswer, 'verdict' | 'evidence'>): Reach => {
  switch (answer.verdict) {
    case 'alive':
      return 'alive';
    case 'dead':
      return 'dead';
    case 'likely-dead':
      return 'maybe';
    default:
      if (answer.evidence.outside !== undefined) return 'outside';
      return node.type === 'entry' && answer.evidence.oneOff === undefined ? 'outside' : 'maybe';
  }
};

/** The edges that run the code a site is written in: a call, a route or action handing it work. */
const SITE_CALLERS = ['calls', 'handles'] as const;

/** The edges by which a caller reaches a way in across a crossing: a request to a route. */
const REQUEST_EDGES: ReadonlySet<string> = new Set(['http_calls', 'hits']);

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

/** One hop back: the node it reaches, whether that node holds the code (see `walk`), and the edge, when it is one. */
interface Step {
  id: string;
  held: boolean;
  edge?: GraphEdge;
  /** The handler a consumer runs: where it is held places the consumer, and what else calls it does not. */
  ran?: true;
}

/** The unread calls of one file, read once per answer: how many, and the first, with the code it is written in. */
interface FileGaps {
  count: number;
  gap: string;
  anchor?: string;
}

/** A crossing into the start's chain: a route said aloud, or `channel <name>`, and the service it is in. */
export interface Crossing {
  said: string;
  repo: string;
  /** The way in crossed, where it is one (a route requested): a row listing it is the one the others reach through (P375). */
  id?: string;
}

/** A way in a walk met, with the crossing it was reached through, if any. */
export interface WayInFound {
  node: GraphNode;
  depth: number;
  /** The crossing nearest the start on its path. */
  via?: Crossing;
  /** The code that handles it on the way to the start (P374), where impact has said it: `handledBy`. */
  by?: GraphNode;
}

/** The nodes that hold code a way in hands work to: what `by` may name. */
const HANDLING_TYPES: ReadonlySet<string> = new Set(['method', 'function', 'ui_component', 'guard', 'interceptor', 'pipe', 'middleware']);

/** Where a chain leaves the code of the way in it starts at: another way in, a request, a publish, a channel. */
const CROSSING_TYPES: ReadonlySet<string> = new Set(['entry', 'ui_api_call', 'http_out', 'producer', 'channel', 'consumer']);

/** The most hops `handledBy` follows from a way in. */
const MOST_HANDLING_HOPS = 64;

/**
 * The code that handles a way in (P374): the first code on the walk's chain
 * from the way in towards the start that is not routing - for a screen, the
 * component it shows; for a route, a bot command or a consumer, the method
 * or function it hands work to; for a webhook whose handler, written where
 * the route is declared, hands the update to a class (a worker's inline
 * handler calling a bot's method), the method of that class. Routing is a
 * function written in the same file as the way in, passed over while the
 * chain holds other code before it leaves the way in's own code (a request
 * out, a publish, another way in); where it holds none, that function
 * handles it. Undefined where the chain holds no code at all.
 */
export const handledBy = (parents: ReadonlyMap<string, WalkedFrom>, node: (id: string) => GraphNode | undefined, way: GraphNode): GraphNode | undefined => {
  let routing: GraphNode | undefined;
  let hops = 0;
  for (let at = parents.get(way.id)?.from; at !== undefined && hops < MOST_HANDLING_HOPS; at = parents.get(at)?.from, hops += 1) {
    const step = node(at);
    if (step === undefined || CROSSING_TYPES.has(step.type)) break;
    if (!HANDLING_TYPES.has(step.type)) continue;
    if (step.type === 'function' && step.repo === way.repo && step.file !== undefined && step.file === way.file) {
      routing ??= step;
      continue;
    }
    return step;
  }
  return routing;
};

/** A crossing as `via` says it on a row: with its service after it where that is not the row's. */
export const viaSaid = (via: Crossing, row: Pick<GraphNode, 'repo'>): string =>
  via.repo !== '' && via.repo !== row.repo ? `${via.said} (${via.repo})` : via.said;

/** How a walk reached a node: the node it stepped back from, and the edge, where the hop was one (P370). */
export interface WalkedFrom {
  from: string;
  edge?: GraphEdge;
}

export interface Walked {
  found: WayInFound[];
  /** Code nothing read calls, where a chain ended without a way in, nearest first. */
  tops: WayInFound[];
  /** Every node met, the start's own left out. */
  met: GraphNode[];
  /** Each node met, by id: the node nearer the start it was reached from, which draws the walk as a tree (P370). */
  parents: Map<string, WalkedFrom>;
  /** The consumers impact's walk did not follow back onto their channel (P372), nearest first. */
  crossings: ChannelCrossing[];
  read: number;
  cut: boolean;
}

/** The crossing a hop back from `node` over `edge` passes, or nothing where it passes none. */
const crossingOf = (node: GraphNode, edge: GraphEdge | undefined): Crossing | undefined => {
  if (edge === undefined) return undefined;
  if (node.type === 'entry' && REQUEST_EDGES.has(edge.type)) {
    return { said: node.kind === undefined || node.kind === 'http' ? node.label : `${node.kind} ${node.label}`, repo: node.repo, id: node.id };
  }
  if (node.type === 'channel' && edge.type === 'emits') return { said: `channel ${node.label}`, repo: '' };
  return undefined;
};

/**
 * Whether a walk back follows a hop (P367, P372).
 *
 * - Never a navigation, however it is stored: a `calls` or `triggers` edge
 *   with `meta.navigates` (`router.navigate([...])`, `navigateByUrl`, a link
 *   a component renders, a guard's redirect), or a link onto a screen or a
 *   component. The code that navigates shows the screen it lands on and calls
 *   none of its code, so it breaks with none of its changes.
 * - Never from what a router or a framework runs before a screen (a guard, a
 *   resolver, a route middleware) back to the screens listing it, unless the
 *   walk reached it through its own code: it is the code asked about, or it
 *   calls code on the way to it (`ownCode`). A guard reached any other way
 *   runs before the screens it guards and runs none of their code.
 */
const walksBack = (node: GraphNode, step: Step, ownCode: boolean): boolean => {
  const edge = step.edge;
  if (edge === undefined) return true;
  if (typeof edge.meta?.[NAVIGATES_META] === 'string') return false;
  if (edge.type === 'triggers' && (node.type === 'ui_component' || (node.type === 'entry' && node.kind === 'screen'))) return false;
  return ownCode || !isRunsBeforeEdge(edge);
};

/**
 * A consumer impact's walk did not follow back onto what it consumes (P372):
 * the channel, or the message type it chooses, whose publishers start it.
 * What publishes there calls none of the code asked about; it is said apart,
 * in `throughChannels`, and not among the ways in.
 */
export interface ChannelCrossing {
  consumer: GraphNode;
  /** The channel, or the message type of one, the consumer consumes. */
  from: GraphNode;
  depth: number;
}

export interface ReachReader {
  /** The reach of one node, or nothing for a node the graph does not hold. */
  of(id: string): RowReach;
  /** A row with its reach after its own fields, at detail 1 and up. */
  annotate<T extends { id?: string }>(row: T): T & RowReach;
  /**
   * Every way in that reaches the starts (P367), walked back past each way in
   * met to the callers beyond it, each with the crossing it was reached
   * through; the code chains end at with no way in; and every node met.
   * No consumer is walked back onto its channel: each is a crossing (P372),
   * which `across` walks on from. Bounded by `limit` nodes, on its own budget.
   */
  waysIn(starts: readonly GraphNode[], limit: number): Walked;
  /**
   * The ways in beyond a channel or a message type a consumer consumes: its
   * publishers, walked back past every way in as `waysIn` walks, channels
   * beyond it crossed. Bounded by `limit` nodes, on its own budget.
   */
  across(from: GraphNode, limit: number): Walked;
  /**
   * Whether the end of a chain is one an unread call or a caller outside the
   * project could reach: judged `maybe` or `outside`, or in a file with a step
   * the reading could not follow and not judged `dead`. Judged, never walked,
   * so many ends cost little; `of` says the same of each.
   */
  maybeEnd(node: GraphNode): boolean;
  /**
   * Whether the end of a chain is code no unread call could reach because its
   * name is written nowhere else in its repository (P370): `unreached`, not a
   * maybe, so impact counts it apart rather than listing it.
   */
  unreachedEnd(node: GraphNode): boolean;
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
  let gapsByFile: Map<string, FileGaps> | undefined;
  const gapsIn = (node: GraphNode): FileGaps | undefined => {
    if (node.file === undefined) return undefined;
    if (gapsByFile === undefined) {
      gapsByFile = new Map();
      for (const row of db.allUnresolved()) {
        // Only a step the reading could not follow, with why, is an unread call: a request that found no route is not one.
        if (row.service === null || row.file === null || !wasMissed(row) || !recordsFollowCause(row)) continue;
        const key = `${row.service}\u0000${row.file}`;
        const known = gapsByFile.get(key);
        if (known !== undefined) known.count += 1;
        else gapsByFile.set(key, { count: 1, gap: gapIdOf({ reason: row.reason, service: row.service, file: row.file }), ...(row.node === null ? {} : { anchor: row.node }) });
      }
    }
    return gapsByFile.get(`${node.repo}\u0000${node.file}`);
  };

  let budget = ANSWER_WALK;
  let judged = 0;
  let unjudged = 0;
  let unwalked = 0;
  const done = new Map<string, RowReach>();

  /**
   * The calls into a node written where a way in that hands it work is
   * registered (P371): `bot.command('items', (ctx) => this.showItems(ctx))`
   * is the command's call, made when the command arrives, not one the method
   * holding the registration makes when it runs.
   */
  const registeredAt = (node: GraphNode): Set<string> => {
    const sites = new Set<string>();
    for (const edge of graph.edgesTo(node.id, ['handles'])) {
      const entry = graph.node(edge.from);
      if (entry?.type === 'entry' && entry.file !== undefined && entry.line !== undefined) sites.add(`${entry.repo}\u0000${entry.file}\u0000${entry.line}`);
    }
    return sites;
  };
  const isRegistration = (node: GraphNode, edge: GraphEdge, sites: Set<string>): boolean =>
    edge.type === 'calls' && edge.file !== undefined && edge.line !== undefined && sites.has(`${node.repo}\u0000${edge.file}\u0000${edge.line}`) && graph.node(edge.from)?.repo === node.repo;

  /**
   * Whether a consumer is a subscription a screen holds (P371): its handlers
   * run in a component, and a way in shows that component (a walk from the
   * handlers, never crossing a channel, bounded as a row's is, meets a way in
   * on a path through a component). It runs where the screen is shown, so
   * the screen is the way in that breaks; what publishes to the channel
   * pushes a message to an open screen and does not start the code behind
   * it. A consumer no screen holds - a back end's worker, run by the message
   * - is walked back onto its channel as before. Judged once per consumer per
   * answer.
   */
  const placedCache = new Map<string, boolean>();
  const isPlaced = (consumer: GraphNode, handlers: readonly GraphEdge[]): boolean => {
    const known = placedCache.get(consumer.id);
    if (known !== undefined) return known;
    placedCache.set(consumer.id, false);
    const starts = handlers.map((edge) => graph.node(edge.to)).filter((node): node is GraphNode => node !== undefined);
    let placed = false;
    if (starts.length > 0) {
      const walked = walk(starts, ROW_WALK, false, false);
      const shown = (id: string): boolean => {
        for (let at: string | undefined = id, hops = 0; at !== undefined && hops <= ROW_WALK; at = walked.parents.get(at)?.from, hops += 1) {
          if (graph.node(at)?.type === 'ui_component') return true;
        }
        return false;
      };
      placed = walked.found.some((way) => shown(way.node.id));
    }
    placedCache.set(consumer.id, placed);
    return placed;
  };

  /**
   * The hops back from a node: the edges every caller walk follows, and the
   * hops that place code in what holds it - a consumer runs in its handler, a
   * component's method runs where the component is shown, a handler's class
   * is built where it is injected, and a template's action belongs to its
   * file's component.
   *
   * Code with callers the reading knows runs where they run: the hop from a
   * method or function to what holds it is taken from a component's method
   * (it runs only where the component is shown), and otherwise only where the
   * code is reached as a whole - a handler a consumer runs, placed by what
   * holds it alone - or has no such caller (P371). A consumer placed in code
   * a way in reaches is not walked back onto its channel; `channels: false`
   * never walks a consumer back onto one.
   */
  const stepsBack = (node: GraphNode, held: boolean, isStart: boolean, holdersOnly = false, channels = true): Step[] => {
    // A consumer runs where its handler is held: the request that opened its
    // stream is shared by every screen that opens one, so it says nothing of which.
    const handlers = node.type === 'consumer' ? graph.edgesFrom(node.id, ['handles']) : [];
    const sites = holdersOnly ? new Set<string>() : registeredAt(node);
    let into = holdersOnly
      ? []
      : graph
          .edgesTo(node.id, REVERSE_EDGES)
          .filter((edge) => (handlers.length === 0 || edge.type !== 'triggers') && (sites.size === 0 || !isRegistration(node, edge, sites)));
    // A consumer that chooses by type runs on the types it selects, not on every publish of their channel.
    const typed = node.type === 'consumer' ? into.filter((edge) => edge.type === 'consumes' && isMessageTypeNode(graph.node(edge.from))) : [];
    if (typed.length > 0) into = into.filter((edge) => edge.type !== 'consumes' || typed.includes(edge));
    if (into.some((edge) => edge.type === 'consumes') && (!channels || (handlers.length > 0 && isPlaced(node, handlers)))) {
      into = into.filter((edge) => edge.type !== 'consumes');
    }
    const steps: Step[] = into.map((edge) => ({ id: edge.from, held: false, edge }));
    for (const edge of handlers) steps.push({ id: edge.to, held: true, ran: true });
    // Callers the reading knows: a consumer handing its message to the code is placement, not a call.
    const called = into.some((edge) => edge.type === 'calls' || edge.type === 'triggers' || (edge.type === 'handles' && !edge.from.startsWith('consumer:')));
    const wholly = held && (holdersOnly || !called);
    if (node.type === 'method' || node.type === 'function') {
      const owner = ownerOf(node.id);
      const holder = owner === undefined ? undefined : graph.node(owner);
      if (holder !== undefined && (holder.type === 'ui_component' || wholly)) steps.push({ id: holder.id, held: true });
    }
    if (CLASS_TYPES.has(node.type) && (held || isStart)) {
      for (const edge of graph.edgesTo(node.id, ['injects'])) steps.push({ id: edge.from, held: true });
    }
    if (node.type === 'ui_component') {
      for (const edge of graph.edgesTo(node.id, ['imports'])) {
        if (graph.node(edge.from)?.type === 'ui_component') steps.push({ id: edge.from, held: true });
      }
    }
    // A template's action, and a module's function a consumer runs, belong to the components of their file.
    if (node.type === 'ui_action' || (node.type === 'function' && wholly)) {
      for (const component of componentsIn(node.repo, node.file)) steps.push({ id: component.id, held: true });
    }
    return steps;
  };

  /**
   * Back from the starts to the ways in on each path. A row's walk stops at
   * the first way in on a path; impact's walks on past each one (`through`),
   * to the callers beyond it, saying the crossing each was reached through.
   * With `channels` false no consumer is walked back onto its channel; with
   * `collapse` none is either, and each consumer that would be - one no
   * screen holds (P371) - is said in `crossings` (P372).
   */
  const walk = (starts: readonly GraphNode[], limit: number, through: boolean, channels = true, collapse = false): Walked => {
    const startIds = new Set(starts.map((start) => start.id));
    const seen = new Set<string>(startIds);
    const found: WayInFound[] = [];
    const tops: WayInFound[] = [];
    const met: GraphNode[] = [];
    const parents = new Map<string, WalkedFrom>();
    const crossings: ChannelCrossing[] = [];
    const queue: Array<{ node: GraphNode; depth: number; held: boolean; via?: Crossing; ran?: true }> = [];
    for (const start of starts) {
      // A handler a consumer runs is held as the consumer's is: where its class or file is shown.
      const handler = graph.edgesTo(start.id, ['handles']).some((edge) => edge.from.startsWith('consumer:'));
      queue.push({ node: start, depth: 0, held: handler });
      if (!CLASS_TYPES.has(start.type)) continue;
      for (const method of methodsOfClass(start.id)) {
        const node = graph.node(method);
        if (node === undefined || seen.has(method)) continue;
        seen.add(method);
        parents.set(method, { from: start.id });
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
      const isStart = startIds.has(node.id);
      if (!isStart) met.push(node);
      const wayIn = !isStart && (node.type === 'entry' || isOutsideConsumer(graph, node));
      if (wayIn) {
        found.push({ node, depth, ...(item.via === undefined ? {} : { via: item.via }) });
        if (!through) continue;
      }
      // Impact's walk lists every way in, so a handler a consumer runs is placed by what holds it alone:
      // whatever else calls the handler (the code that subscribes it, say) does not reach the consumer.
      const back = stepsBack(node, item.held, isStart, through && item.ran === true, channels).filter((step) =>
        walksBack(node, step, isStart || !item.held),
      );
      let steps = back;
      if (collapse && node.type === 'consumer') {
        steps = back.filter((step) => step.edge?.type !== 'consumes');
        // A consumer that never runs (P374) is no crossing: nothing beyond its channel reaches the code through it.
        const runs = reachOf(node)?.reach !== 'dead';
        for (const step of runs ? back : []) {
          const from = step.edge?.type === 'consumes' ? graph.node(step.id) : undefined;
          if (from !== undefined) crossings.push({ consumer: node, from, depth });
        }
      }
      if (!wayIn && back.length === 0) tops.push({ node, depth, ...(item.via === undefined ? {} : { via: item.via }) });
      for (const step of steps) {
        if (seen.has(step.id)) continue;
        seen.add(step.id);
        const reached = graph.node(step.id);
        if (reached === undefined) continue;
        parents.set(step.id, { from: node.id, ...(step.edge === undefined ? {} : { edge: step.edge }) });
        const via = item.via ?? crossingOf(node, step.edge);
        queue.push({ node: reached, depth: depth + 1, held: step.held, ...(via === undefined ? {} : { via }), ...(step.ran === true ? { ran: true as const } : {}) });
      }
    }
    return { found, tops, met, parents, crossings, read, cut };
  };

  /**
   * A row's walk, on the answer's budget: first the ways in whose code calls
   * it, never across a channel, then, where it meets none, those beyond the
   * channels its consumers take messages from (P372), so `ways` counts the
   * callers and code only a message starts is still reached. With `channels`
   * false, only the first.
   */
  const rowWalk = (start: GraphNode, channels = true): Walked => {
    const walked = walk([start], Math.min(ROW_WALK, budget), false, false);
    budget -= walked.read;
    if (walked.found.length > 0 || walked.cut || budget <= 0 || !channels) return walked;
    const across = walk([start], Math.min(ROW_WALK, budget), false);
    budget -= across.read;
    return across;
  };

  /**
   * A verdict's reach, where the code's name is written nowhere else in its
   * repository and its file holds no unread call: `unreached`, since an
   * unread call writes the name it calls (P370).
   */
  const settled = (node: GraphNode, answer: DeadAnswer): Reach => {
    const reach = reachOfVerdict(node, answer);
    return reach === 'maybe' && answer.evidence.unreferenced === true && gapsIn(node) === undefined ? 'unreached' : reach;
  };

  /** The verdict of a node `dead` judges, or the liveliest of the code a site is written in, as `reach`. */
  const reachOf = (node: GraphNode): { reach: Reach; answer: DeadAnswer } | undefined => {
    if (JUDGED_TYPES.includes(node.type)) {
      const answer = verdictOf(node.id);
      return answer === undefined ? undefined : { reach: settled(node, answer), answer };
    }
    let best: { caller: GraphNode; answer: DeadAnswer } | undefined;
    for (const edge of graph.edgesTo(node.id, SITE_CALLERS)) {
      const caller = graph.node(edge.from);
      if (caller === undefined || !JUDGED_TYPES.includes(caller.type)) continue;
      const answer = verdictOf(caller.id);
      if (answer !== undefined && (best === undefined || VERDICT_ORDER[answer.verdict] > VERDICT_ORDER[best.answer.verdict])) best = { caller, answer };
    }
    return best === undefined ? undefined : { reach: settled(best.caller, best.answer), answer: best.answer };
  };

  /**
   * The first end of a chain an unread call could reach, nearest first: code
   * judged `likely-dead`, or said unknown with nothing outside named, or in a
   * file with an unread call. Each is judged once per answer.
   */
  const firstMaybe = (tops: readonly WayInFound[], row: GraphNode, rowReach: Reach): { top: GraphNode; gaps?: FileGaps } | undefined => {
    for (const { node } of tops) {
      const gaps = gapsIn(node);
      if (gaps !== undefined) return { top: node, gaps };
      const reach = node.id === row.id ? rowReach : JUDGED_TYPES.includes(node.type) ? reachOf(node)?.reach : 'maybe';
      if (reach === 'maybe' || reach === 'outside') return { top: node };
    }
    return undefined;
  };

  /** Where a `maybe` row is reached from: the nearest way in beyond its unread call, when the call's code is known. */
  const beyondGap = (gaps: FileGaps | undefined, row: GraphNode): string => {
    const anchor = gaps?.anchor === undefined ? undefined : graph.node(gaps.anchor);
    if (anchor === undefined || budget <= 0) return FROM_BEHIND;
    const walked = rowWalk(anchor);
    const nearest = nearestOf(walked.found, row);
    return nearest === undefined ? FROM_BEHIND : wayInSaid(graph, nearest.node, row.repo === '' ? undefined : row.repo);
  };

  /** The nearest of the ways in met, the row's own service first. */
  const nearestOf = (found: readonly WayInFound[], row: GraphNode): WayInFound | undefined => {
    const own = found.filter((way) => way.node.repo === row.repo);
    const pool = own.length > 0 ? own : found;
    return [...pool].sort((a, b) => a.depth - b.depth || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0))[0];
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
    const judgedReach = reachOf(node);
    let row: RowReach = judgedReach === undefined ? {} : { reach: judgedReach.reach };
    // A way in is its own; only code below one is walked back from.
    if (node.type !== 'entry' && judgedReach !== undefined) {
      if (budget <= 0) unwalked += 1;
      else {
        // A consumer judged never to run (its subscription made by code nothing runs, P374) is not reached by what
        // publishes to its channel: the message has no subscription to arrive at.
        const walked = rowWalk(node, !(node.type === 'consumer' && judgedReach.reach === 'dead'));
        const nearest = nearestOf(walked.found, node);
        const ways = new Set(walked.found.map((way) => way.node.id)).size;
        const nowhere = nearest === undefined && !walked.cut;
        let reach = judgedReach.reach;
        // Nothing read reaches it: a chain that ends where an unread call could reach is a maybe, not a no.
        const maybe = nowhere && (reach === 'alive' || reach === 'maybe') ? firstMaybe(walked.tops, node, reach) : undefined;
        if (nowhere && reach === 'alive') reach = maybe === undefined ? 'unreached' : 'maybe';
        const behind = maybe === undefined || maybe.top.id === node.id ? undefined : maybe.top.id;
        row = {
          reach,
          ...(nearest !== undefined
            ? { from: wayInSaid(graph, nearest.node, node.repo === '' ? undefined : node.repo) }
            : walked.cut
              ? {}
              : { from: reach === 'maybe' ? beyondGap(maybe?.gaps, node) : 'none' }),
          ...(ways > 1 ? { ways } : {}),
          ...(walked.cut ? { walkCut: true as const } : {}),
          ...(reach !== 'maybe' || maybe?.gaps === undefined ? {} : { gap: maybe.gaps.gap }),
          ...(reach !== 'maybe' || behind === undefined ? {} : { behind }),
        };
      }
    }
    // Code nothing names is reached from nowhere, though what holds it is shown somewhere (P370).
    if (row.reach === 'unreached' && judgedReach?.answer.evidence.unreferenced === true) row = { reach: 'unreached', from: 'none' };
    // A maybe nothing was walked back from (a way in, a walk cut short) says why `dead` says it may be called; a walked
    // one says it with `from`, and with `gap` and `behind` where an unread call or another chain end was met.
    if (row.reach === 'maybe' && row.from === undefined && judgedReach !== undefined) row = { ...row, behind: judgedReach.answer.reason };
    done.set(id, row);
    return row;
  };

  return {
    of,
    annotate: (row) => (detail < 1 || row.id === undefined ? (row as typeof row & RowReach) : { ...row, ...of(row.id) }),
    waysIn: (starts, limit) => walk(starts, limit, true, true, true),
    across: (from, limit) => walk([from], limit, true),
    maybeEnd: (node) => {
      const reach = reachOf(node)?.reach;
      return reach === 'maybe' || reach === 'outside' || (reach === 'alive' && gapsIn(node) !== undefined);
    },
    unreachedEnd: (node) => {
      const judged = reachOf(node);
      return judged?.reach === 'unreached' && judged.answer.evidence.unreferenced === true;
    },
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
