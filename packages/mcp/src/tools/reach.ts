import { frameworkCallOf, isMessageTypeNode, wasMissed, type GraphNode } from '@flowatlas/core';
import { classifyRoute, methodsOf, routeFactsOf, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, projectEdge, truncate } from '../query/detail.js';
import { isResolved, resolveSymbol, type EntryRef, type Resolved } from '../query/entry-ref.js';
import { nearNames } from '../query/names.js';
import { requestsOf } from '../query/requests.js';
import { REVERSE_EDGES } from '../query/flow.js';
import { truncationMessage, type FlowNode } from '../query/types.js';
import { MAX_NEXT, nextFor, withNext, withoutShown, type RowShown } from '../query/next.js';
import { annotateTree, deadOptionsOf, handledBy, reachReader, viaSaid, type ReachReader, type Walked, type WalkedFrom, type WayInFound } from '../query/ways-in.js';
import type { DbHandle } from '../query/db.js';
import { figuresOf, loadObservedCounts, markObserved, nodeAmbiguous, nodeRow } from '../query/observed.js';
import { slimForest } from '../query/wire.js';
import { withDocs } from '../query/docs.js';
import {
  answerEach,
  askedOf,
  bound,
  callOf,
  commonInput,
  COMMON_DEFAULTS,
  completeOf,
  inService,
  pagedNext,
  pageInput,
  pageLeft,
  READ_ONLY,
  serviceInput,
  severalInput,
  withDb,
  type ToolContext,
} from './common.js';

/** The deepest who_calls walks; past it the answer names the ids to ask from instead. */
const MAX_CALLER_DEPTH = 16;
/** The depth other tools' hints leave out when they name a deeper who_calls. */
const DEFAULT_CALLER_DEPTH = 3;

/**
 * How many hops of callers who_calls draws as a tree when no `depth` is asked
 * (P376): the ways in past them are listed once each, with how far they are.
 * One hop on a class or several symbols: each asked symbol's direct callers.
 */
const NEAR_CALLER_DEPTH = 2;
const NEAR_CALLER_DEPTH_SEVERAL = 1;

/** The most nodes who_calls's walk to the ways in reads for all the symbols asked together; each on impact's bound. */
const CALLERS_WALK_TOTAL = 20000;

/** The most nodes impact's walk reads before it stops and says so. */
const IMPACT_WALK_NODES = 4000;

/** The most nodes the walk beyond one channel reads (P372): its ways in are counted, a floor past it. */
const CHANNEL_WALK_NODES = 1000;

/** How many of the ways in beyond a channel its row names. */
const CHANNEL_SAMPLE = 3;

/**
 * An ambiguous name, answered with the candidates and the same call once per
 * candidate (P94): asking again is what the asker does next, and pointing at
 * other tools for the first candidate alone made the rest look second-best.
 */
const candidatesAnswer = (
  found: Extract<EntryRef, { candidates: unknown }>,
  input: { symbol: string },
  detail: 0 | 1 | 2 | 3,
  retry: (id: string) => string,
): object =>
  found.candidates.length === 0
    ? { error: `no symbol matches ${JSON.stringify(input.symbol)}` }
    : withNext(
        { candidates: found.candidates.map((node) => projectDetail(node, detail)) },
        found.candidates.slice(0, MAX_NEXT).map((node) => retry(node.id)),
      );

/** The gap rows of each service's file, by `service\0file`, read once per answer. */
const gapsByFile = (db: GraphDb): ((node: GraphNode) => number) => {
  let counts: Map<string, number> | undefined;
  return (node) => {
    if (node.file === undefined) return 0;
    if (counts === undefined) {
      counts = new Map();
      for (const row of db.allUnresolved()) {
        if (row.service === null || row.file === null || !wasMissed(row)) continue;
        const key = `${row.service}\u0000${row.file}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts.get(`${node.repo}\u0000${node.file}`) ?? 0;
  };
};

/**
 * Where to look when a caller chain ends in a node nothing calls (P94 D3):
 * the gaps of its service, and those of its file, any of which may be the
 * call the reading missed.
 */
const gapLeads = (node: GraphNode): string[] => [
  ...(node.repo === '' ? [] : [callOf('cant_follow', { service: node.repo })]),
  ...(node.file === undefined ? [] : [callOf('search', { query: node.file, kinds: ['gaps'] })]),
];

/** A node that is no way in and that nothing reaches: the end of a caller chain. */
const isTopOfChain = (node: GraphNode, callers: readonly unknown[]): boolean =>
  node.type !== 'entry' && callers.length === 0;

const missingNode = (id: string): FlowNode['node'] => ({ id, type: 'missing', label: id });

interface Callers {
  callers: FlowNode[];
  /**
   * Callers `maxNodes` left out. The depth line is where the tree stops being
   * drawn, not a cut: the ways in past it are listed apart (P376, P379).
   */
  cutByNodes: number;
  /** Nothing calls the target itself, and it is no way in: the gaps in its file, else undefined. */
  targetTop?: number;
}

/**
 * Where a caller walk starts (P95): the node itself, or, for a class, each of
 * its methods something calls. Calls point at methods, never at the class, so
 * a class asked about as itself answered nothing; it answers for the union of
 * its methods, each caller naming the method it calls.
 */
const startsOf = (db: GraphDb, target: GraphNode): { starts: GraphNode[]; forClass: boolean } => {
  if (target.type !== 'provider') return { starts: [target], forClass: false };
  const called = methodsOf(db, target.id)
    .map((id) => db.node(id))
    .filter((node): node is GraphNode => node !== undefined && db.edgesTo(node.id, REVERSE_EDGES).length > 0);
  return called.length === 0 ? { starts: [target], forClass: false } : { starts: called, forClass: true };
};

/**
 * Walks inward from a node and builds the tree of what reaches it.
 *
 * The same shape as a forward walk, read the other way round: each child is
 * something that calls its parent. Breadth first, so the nearest callers are
 * the ones that survive a cut. The tree stops at the depth asked, where the
 * walk to the ways in takes over (P376, P379); a row nothing calls is the top
 * of its chain and says so.
 */
const callersOf = (
  db: GraphDb,
  target: GraphNode,
  depth: number,
  maxNodes: number,
  detail: 0 | 1 | 2 | 3,
): Callers => {
  const gapsIn = gapsByFile(db);
  const roots: FlowNode[] = [];
  const { starts, forClass } = startsOf(db, target);
  const queue: Array<{ node: GraphNode; level: number; into: FlowNode[]; row?: FlowNode; path: ReadonlySet<string>; calls?: string }> =
    starts.map((start) => ({
      node: start,
      level: 0,
      into: roots,
      path: new Set([target.id, start.id]),
      ...(forClass ? { calls: start.id } : {}),
    }));
  let cutByNodes = 0;
  let targetTop: number | undefined;
  let used = 0;

  while (queue.length > 0) {
    const item = queue.shift()!;
    const edges = db.edgesTo(item.node.id, REVERSE_EDGES);
    if (isTopOfChain(item.node, edges)) {
      if (item.row === undefined) targetTop = gapsIn(item.node);
      else {
        item.row.topOfChain = true;
        item.row.gapsInFile = gapsIn(item.node);
      }
      continue;
    }
    if (item.level >= depth) continue;
    const open = edges.filter((edge) => !item.path.has(edge.from));

    for (const edge of open) {
      if (used >= maxNodes) {
        cutByNodes += 1;
        continue;
      }
      const source = db.node(edge.from);
      // An edge from a node the graph does not hold is a caller all the same:
      // said as a missing row, as get_flow says one, rather than dropped.
      const flow: FlowNode = {
        node: source === undefined ? missingNode(edge.from) : projectDetail(source, detail),
        edge: projectEdge(edge, detail),
        ...(item.calls === undefined ? {} : { calls: item.calls }),
        children: [],
      };
      used += 1;
      item.into.push(flow);
      if (source === undefined) continue;
      queue.push({
        node: source,
        level: item.level + 1,
        into: flow.children,
        row: flow,
        path: new Set([...item.path, edge.from]),
      });
    }
  }

  return { callers: roots, cutByNodes, ...(targetTop === undefined ? {} : { targetTop }) };
};

/**
 * The callers tree with only the branches that lead to the service asked for.
 *
 * A branch is kept when it or anything below it is in the service, so the path
 * from the target to a caller in that service survives whole.
 */
const keepService = (db: GraphDb, nodes: FlowNode[], service: string | undefined): FlowNode[] => {
  if (service === undefined) return nodes;
  const kept: FlowNode[] = [];
  for (const item of nodes) {
    const children = keepService(db, item.children, service);
    // Looked up rather than read off the row: at detail 0 a row names no service.
    if (db.node(item.node.id)?.repo === service || children.length > 0) kept.push({ ...item, children });
  }
  return kept;
};

/** The first node of a tree, breadth first, that passes a test. */
const findFirst = (nodes: readonly FlowNode[], test: (item: FlowNode) => boolean): FlowNode | undefined => {
  const queue = [...nodes];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (test(item)) return item;
    queue.push(...item.children);
  }
  return undefined;
};

/** Every row of a tree, for what `next` need not ask again (P364). */
const rowsOf = (nodes: readonly FlowNode[]): RowShown[] => {
  const rows: RowShown[] = [];
  const queue = [...nodes];
  while (queue.length > 0) {
    const item = queue.shift()!;
    rows.push(item.node);
    queue.push(...item.children);
  }
  return rows;
};

/** What who_calls was asked, less the symbol, which each answer of several takes in turn. */
interface WhoCallsAsked {
  /** How far the tree is drawn; unset, its first hops. Every way in past it is listed whatever it is (P376, P379). */
  depth?: number | undefined;
  /** Picks the symbol among same-named ones; cuts the rows only where the symbol lies outside it (P381). */
  service?: string | undefined;
  /** Keep only the callers and ways in of this service (P381). */
  callersIn?: string | undefined;
  detail: number;
  maxNodes: number;
}

/** What impact is asked: the tool's input, which the command line hands it too (P370). */
export interface ImpactInput {
  symbol?: string | undefined;
  /** Several symbols, one change (P381): every way in that calls any of them, once. */
  symbols?: string[] | undefined;
  /** Picks the symbol among same-named ones; cuts the rows only where the symbol lies outside it (P381). */
  service?: string | undefined;
  /** Keep only the ways in of this service (P381). */
  callersIn?: string | undefined;
  detail: number;
  maxNodes: number;
  offset?: number | undefined;
  /**
   * A channel of `throughChannels`: list the ways in beyond it instead (P372);
   * or a consumer a row names, for the ways in beyond every channel of its row (P378).
   */
  channel?: string | undefined;
}

/**
 * The ways in reached only across one channel (P372): a consumer on the way
 * to the code takes messages from it, and what publishes there - and what
 * calls that - calls none of the code. Counted and sampled, not listed.
 */
export interface ThroughChannel {
  /** The channel's name as written, and the message type the consumer chooses, if it chooses one. */
  channel: string;
  type?: string;
  /** The node the consumer consumes: the channel, or its message type. */
  from: GraphNode;
  /** The consumer nearest the code, and how many on the way take messages from it, by id. */
  consumer: GraphNode;
  consumers: number;
  takenBy: string[];
  ways: WayInFound[];
  /** The walk beyond the channel stopped at its bound: `ways` is a floor. */
  cut: boolean;
  walked: Walked;
}

/** A channel, or a message type of one, as `throughChannels` says it. */
const channelSaid = (db: GraphDb, node: GraphNode): { channel: string; type?: string } => {
  if (!isMessageTypeNode(node)) return { channel: node.label };
  const channelId = typeof node.meta?.channel === 'string' ? node.meta.channel : undefined;
  const channel = channelId === undefined ? undefined : db.node(channelId);
  const type = typeof node.meta?.messageType === 'string' ? node.meta.messageType : undefined;
  return { channel: channel?.label ?? node.label, ...(type === undefined ? {} : { type }) };
};

/** Whether the channel `channel` asks for is this one: by its name, its id, or a message type's channel. */
const isChannelAsked = (through: ThroughChannel, asked: string): boolean =>
  through.channel === asked || through.from.id === asked || `channel:${through.channel}` === asked;

/** Whether `channel` names the consumer a row of `throughChannels` is said under, by its id or its name (P378). */
const isConsumerAsked = (through: ThroughChannel, asked: string): boolean => through.consumer.id === asked || through.consumer.label === asked;

const byDepthThenId = (a: WayInFound, b: WayInFound): number =>
  a.depth - b.depth || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0);

/**
 * The channels a walk did not cross (P372), each walked on from by itself
 * past every way in, its ways in those the walk to the code did not meet.
 */
const throughChannelsOf = (db: GraphDb, reader: ReachReader, walked: Walked, keep: (way: WayInFound) => boolean): ThroughChannel[] => {
  const groups = new Map<string, { from: GraphNode; consumers: GraphNode[] }>();
  for (const crossing of walked.crossings) {
    const group = groups.get(crossing.from.id);
    if (group === undefined) groups.set(crossing.from.id, { from: crossing.from, consumers: [crossing.consumer] });
    else if (!group.consumers.some((consumer) => consumer.id === crossing.consumer.id)) group.consumers.push(crossing.consumer);
  }
  const met = new Set(walked.found.map((way) => way.node.id));
  const rows: ThroughChannel[] = [];
  for (const group of groups.values()) {
    const beyond = reader.across(group.from, CHANNEL_WALK_NODES);
    const ways = beyond.found.filter((way) => way.node.type === 'entry' && !met.has(way.node.id) && keep(way));
    for (const way of ways) withHandler(db, beyond, way);
    rows.push({
      ...channelSaid(db, group.from),
      from: group.from,
      consumer: group.consumers[0]!,
      consumers: group.consumers.length,
      takenBy: group.consumers.map((consumer) => consumer.id),
      ways: [...ways].sort(byDepthThenId),
      cut: beyond.cut,
      walked: beyond,
    });
  }
  const key = (row: ThroughChannel): string => `${row.channel}\u0000${row.type ?? ''}`;
  return rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
};

/** A way in with the code that handles it on the walk's chain (P374), said once. */
const withHandler = (db: GraphDb, walked: Pick<Walked, 'parents'>, way: WayInFound): WayInFound => {
  if (way.by === undefined) {
    const by = handledBy(walked.parents, (id) => db.node(id), way.node);
    if (by !== undefined && by.id !== way.node.id) way.by = by;
  }
  return way;
};

/** What `entriesNone` says when ways in lie only beyond channels (P372). */
const beyondSaid = (ways: number): string =>
  `no way in calls this; ${ways} way${ways === 1 ? ' in lies' : 's in lie'} beyond a channel a consumer on the way takes messages from: throughChannels`;

/** The ways in beyond any of the channels, each once, nearest first (P378): a route publishing on two is one way in. */
const distinctWays = (throughs: readonly ThroughChannel[]): WayInFound[] => {
  const ways = new Map<string, WayInFound>();
  for (const through of throughs) {
    for (const way of through.ways) {
      const known = ways.get(way.node.id);
      if (known === undefined || way.depth < known.depth) ways.set(way.node.id, way);
    }
  }
  return [...ways.values()].sort(byDepthThenId);
};

/**
 * The channels a walk did not cross, said once per consumer (P378): the
 * consumer nearest the code, every channel (and message type) it takes
 * messages from on the way, and the ways in beyond any of them, each once.
 * One consumer on three channels was three rows repeating the same ways in.
 */
export interface ThroughConsumer {
  consumer: GraphNode;
  /** Its channels, each with the message type it chooses where it chooses one, as `throughChannels` says them. */
  channels: Array<{ channel: string; type?: string }>;
  /** How many consumers on the way take messages from these channels: more than one where others do too. */
  consumers: number;
  ways: WayInFound[];
  /** A walk beyond one of them stopped at its bound: `ways` is a floor. */
  cut: boolean;
  /** The channels' own rows, as walked. */
  throughs: ThroughChannel[];
}

/** The rows of `throughChannels`, by the consumer each is said under, in the order of their first channel (P378). */
export const throughByConsumer = (throughs: readonly ThroughChannel[]): ThroughConsumer[] => {
  const groups = new Map<string, ThroughChannel[]>();
  for (const through of throughs) groups.set(through.consumer.id, [...(groups.get(through.consumer.id) ?? []), through]);
  return [...groups.values()].map((rows) => ({
    consumer: rows[0]!.consumer,
    channels: rows.map((row) => ({ channel: row.channel, ...(row.type === undefined ? {} : { type: row.type }) })),
    consumers: new Set(rows.flatMap((row) => row.takenBy)).size,
    ways: distinctWays(rows),
    cut: rows.some((row) => row.cut),
    throughs: rows,
  }));
};

/** A channel as a row of `throughChannels` lists it: its name, or `{channel, type}` where the consumer chooses a type. */
const channelOfRow = (said: { channel: string; type?: string }): string | { channel: string; type: string } =>
  said.type === undefined ? said.channel : { channel: said.channel, type: said.type };

/**
 * One consumer's row of `throughChannels` (P378): its channels, how many
 * distinct ways in lie beyond them, and, where `sample`, the nearest few.
 * who_calls asks who calls the code, so it counts them only.
 */
const throughRow = (through: ThroughConsumer, sample: boolean): object => ({
  consumer: through.consumer.id,
  channels: through.channels.map(channelOfRow),
  ...(through.consumers > 1 ? { consumers: through.consumers } : {}),
  ways: through.ways.length,
  ...(sample
    ? { sample: through.ways.slice(0, CHANNEL_SAMPLE).map((way) => ({ id: way.node.id, ...(way.by === undefined ? {} : { by: way.by.id }) })) }
    : {}),
  ...(through.cut ? { walkCut: true } : {}),
});

/**
 * The call listing the ways in beyond a row of `throughChannels` (P378): by its
 * one channel, or by the consumer where it takes messages from several.
 */
const acrossCall = (symbols: Readonly<Record<string, unknown>>, through: ThroughConsumer): string =>
  callOf('impact', { ...symbols, channel: through.channels.length === 1 ? through.channels[0]!.channel : through.consumer.id });

/**
 * The walk to the code and the walks beyond the channels asked for, as one,
 * so the command line draws the chain to each way in past a channel: the
 * channel hangs under the consumer that takes messages from it.
 */
const joinedWalk = (walked: Walked, throughs: readonly ThroughChannel[]): Walked => {
  const parents = new Map<string, WalkedFrom>(walked.parents);
  const met = [...walked.met];
  const seen = new Set(met.map((node) => node.id));
  for (const through of throughs) {
    if (!seen.has(through.from.id)) {
      seen.add(through.from.id);
      met.push(through.from);
      parents.set(through.from.id, { from: through.consumer.id });
    }
    for (const node of through.walked.met) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      met.push(node);
      const step = through.walked.parents.get(node.id);
      if (step !== undefined) parents.set(node.id, step);
    }
  }
  return { ...walked, met, parents };
};

/** impact's answer, and the walk it was read from, which the command line draws as a tree (P370). */
export interface ImpactOf {
  answer: object;
  detail: 0 | 1 | 2 | 3;
  target?: GraphNode;
  starts?: GraphNode[];
  walked?: Walked;
  /** The rows of this page, ways in then maybe ends, in the answer's order. */
  listed?: WayInFound[];
  /** Every way in listed, on any page, and every maybe end. */
  ways?: WayInFound[];
  maybes?: WayInFound[];
  servicesWithoutEntry?: string[];
  /** The ways in reached only across a channel, by channel (P372); with `channel` asked, those listed. */
  throughChannels?: ThroughChannel[];
}

/**
 * The service whose rows an answer keeps (P381): `callersIn` where asked;
 * otherwise `service`, but only where a symbol asked lies outside it - a
 * service that holds what was asked picked it among same-named ones, and
 * cutting its callers to that service answered "nothing reaches this" for a
 * route the other services request.
 */
const rowsInOf = (targets: readonly GraphNode[], service: string | undefined, callersIn: string | undefined): string | undefined =>
  callersIn ?? (service !== undefined && targets.some((target) => target.repo !== '' && target.repo !== service) ? service : undefined);

/** What a filter on the rows left out, said in `left` (P381): a filtered answer is never the whole one. */
const filterLeft = (count: number, rowsIn: string | undefined, callersIn: string | undefined): string | false =>
  count > 0 &&
  rowsIn !== undefined &&
  `filter: ${count} way${count === 1 ? ' in' : 's in'} in other services left out (${callersIn === undefined ? 'service' : 'callersIn'}: ${rowsIn})`;

/** What a fuzzy answer says in `left` (P381): nothing holds the name asked, so it is never the whole answer. */
const fuzzyLeft = (symbol: string, answered: number): string =>
  `fuzzy: no name holds ${JSON.stringify(symbol)}; ${answered === 1 ? 'the nearest is' : `the ${answered} nearest are`} answered`;

/** How many of the nodes a name could mean are answered each (P381); past it, they are listed as candidates. */
const MAX_ANSWERED = 3;

/** The reaches, liveliest first, by which the nodes a name could mean are answered (P381). */
const REACH_ORDER: Readonly<Record<string, number>> = { alive: 0, outside: 1, maybe: 2, unreached: 3, dead: 4 };

/** The node types a name nothing holds is looked for among, a few edits away. */
const NEAR_TYPES = ['entry', 'method', 'function', 'provider', 'ui_component'] as const;

/**
 * A name that means more than one node, or none (P381): two or three are
 * each answered in one answer, the liveliest first, so the asker never needs
 * a second call; more are listed as candidates (P94). A name nothing holds
 * answers the nearest names, a few edits away, `fuzzy`: never complete, and
 * never an empty answer where something is near.
 */
const candidatesEach = (
  db: GraphDb,
  reader: ReachReader,
  found: Extract<EntryRef, { candidates: unknown }>,
  symbol: string,
  detail: 0 | 1 | 2 | 3,
  run: (id: string) => object,
  retry: (id: string) => string,
): object => {
  const near =
    found.candidates.length > 0
      ? undefined
      : nearNames(
          (() => {
            const pool = db.search(symbol.trim(), { limit: 200 });
            return pool.length > 0 ? pool : NEAR_TYPES.flatMap((type) => db.nodesByType(type));
          })(),
          symbol.trim(),
          MAX_ANSWERED,
        );
  const nodes = near ?? found.candidates;
  const fuzzy = near !== undefined || found.fuzzy === true;
  if (nodes.length === 0) return { error: `no symbol matches ${JSON.stringify(symbol)}`, next: [callOf('find_symbol', { query: symbol })] };
  if (nodes.length > MAX_ANSWERED) return { ...candidatesAnswer({ candidates: nodes }, { symbol }, detail, retry), ...(fuzzy ? { fuzzy: true } : {}) };
  // The liveliest first; among alike, the one more is joined to (its ways in, else its callers), then by id.
  const rank = (node: GraphNode): number => REACH_ORDER[reader.of(node.id).reach ?? ''] ?? 5;
  const joined = (node: GraphNode): number => reader.of(node.id).ways ?? db.edgesTo(node.id, REVERSE_EDGES).length;
  const ranked = [...nodes].sort((a, b) => rank(a) - rank(b) || joined(b) - joined(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (ranked.length === 1) {
    const { next, left, complete: _complete, ...answer } = run(ranked[0]!.id) as Record<string, unknown> & { next?: string[]; left?: string[] };
    if (typeof answer['error'] === 'string') return { ...answer, ...(next === undefined ? {} : { next }) };
    return { fuzzy: true, ...answer, complete: false, left: [fuzzyLeft(symbol, 1), ...(left ?? [])], ...(next === undefined ? {} : { next }) };
  }
  const { next, left: eachLeft, complete, ...each } = answerEach('symbol', ranked.map((node) => node.id), run) as Record<string, unknown> & {
    next?: string[];
    left?: string[];
    complete?: boolean;
  };
  const left = [...(fuzzy ? [fuzzyLeft(symbol, ranked.length)] : []), ...(eachLeft ?? [])];
  return {
    // Said first, so the answers below read as what the name could mean.
    ambiguous: `${JSON.stringify(symbol)} ${fuzzy ? 'is near' : 'names'} ${ranked.length} symbols; each is answered, the liveliest first`,
    ...(fuzzy ? { fuzzy: true } : {}),
    ...each,
    ...(left.length === 0 ? (complete === undefined ? {} : { complete }) : { complete: false, left }),
    ...(next === undefined ? {} : { next }),
  };
};

/** The ways in an impact answer sums up by (P381): what a person reads "which screens break" as. */
const kindOfWay = (node: GraphNode): string => {
  if (node.type === 'consumer') return 'consumers';
  // A hook the framework calls at startup or shutdown (P399).
  if (frameworkCallOf(node) !== undefined) return 'startup';
  switch (node.kind) {
    case 'screen':
      return 'screens';
    case 'http':
    case 'rpc':
      return 'routes';
    case 'event':
      return 'consumers';
    case 'cron':
    case 'task':
    case 'workflow':
      return 'jobs';
    case 'invoke':
      return 'functions';
    default:
      return isBotKind(node.kind) ? 'bots' : 'other';
  }
};

/** A bot's way in: a command, a callback, an update, a step of a scene. */
const isBotKind = (kind: string | undefined): boolean => kind !== undefined && (kind.startsWith('bot_') || kind === 'scene_step');

/**
 * The gaps that leave a bot's way in unnamed (P396): a trigger written as a
 * value, handlers registered where the reading could not find them. A file
 * holding one is a bot's, though no way in of it is drawn.
 */
const BOT_GAP_REASONS: ReadonlySet<string> = new Set(['dynamic-bot-trigger', 'bot-handlers-not-found']);

/**
 * The files of a bot's code, by `service\0file` (P396): where a bot's way in
 * is registered, where the code handling one is written, and where a bot's
 * trigger was left unread. A route handled in one of them is the bot's
 * webhook, how its updates arrive, and code in one of them behind an unread
 * call is the bot's: either breaks a bot, not an API.
 */
const botFilesOf = (db: GraphDb): ReadonlySet<string> => {
  const files = new Set<string>();
  const add = (node: Pick<GraphNode, 'repo' | 'file'> | undefined): void => {
    if (node?.file !== undefined) files.add(`${node.repo}\u0000${node.file}`);
  };
  for (const entry of db.nodesByType('entry')) {
    if (!isBotKind(entry.kind)) continue;
    add(entry);
    for (const edge of db.edgesFrom(entry.id, ['handles'])) add(db.node(edge.to));
  }
  for (const row of db.allUnresolved()) if (row.service !== null && row.file !== null && BOT_GAP_REASONS.has(row.reason)) files.add(`${row.service}\u0000${row.file}`);
  return files;
};

/** The most hops a way in's chain is followed towards the changed code to tell whether a bot's code is on it. */
const MOST_CHAIN_HOPS = 64;

/** The kind a webhook or a callback is said under, by the role `dead` reads off its address and names. */
const RECEIVER_KINDS: Readonly<Record<string, string>> = { webhook: 'webhooks', callback: 'webhooks' };

/**
 * The ways in that break, by kind and service, each the file of the code that
 * handles it (P381): `{screens: {web: ["src/app/browse-page.component.ts"]}}`,
 * the answer to "which screens, bots, consumers break" in a line.
 *
 * Every way in is counted by what it is (P396): a route handled by a bot's
 * code is the bot's webhook, a bot; a route whose address or name says it
 * receives what a provider posts is a webhook; a `maybe` row - code an unread
 * call could reach - under the kind its file says (a bot's file, or the one
 * kind its service's ways in are), its file marked `(maybe)`. `changing` is
 * apart: the routes of the changed code's own service that the other rows
 * request it through, the API being changed, never a webhook or a bot's way in.
 */
const byKindOf = (
  db: GraphDb,
  handle: Pick<DbHandle, 'config'>,
  ways: readonly WayInFound[],
  maybes: readonly WayInFound[],
  targets: readonly GraphNode[],
  walked: Pick<Walked, 'parents'>,
  ownIds: ReadonlySet<string>,
): { byKind?: Record<string, Record<string, string[]>>; changing?: string[] } => {
  const own = new Set(targets.map((target) => target.repo));
  const bots = botFilesOf(db);
  const isBotFile = (node: Pick<GraphNode, 'repo' | 'file'> | undefined): boolean => node?.file !== undefined && bots.has(`${node.repo}\u0000${node.file}`);
  const options = deadOptionsOf(handle);
  // The routes another row reaches the changed code through.
  const requested = new Set([...ways, ...maybes].flatMap((way) => (way.via?.id === undefined || way.via.id === way.node.id ? [] : [way.via.id])));
  const changing: string[] = [];
  const groups = new Map<string, Map<string, Set<string>>>();
  const put = (kind: string, repo: string, file: string): void => {
    const services = groups.get(kind) ?? new Map<string, Set<string>>();
    groups.set(kind, services);
    services.set(repo, (services.get(repo) ?? new Set()).add(file));
  };
  // Whether the code between a way in and the changed code runs through a bot's file: the route hands the bot its
  // updates, wherever the code handling the route itself is written (a controller handing them to the bot's class).
  const throughBot = (way: WayInFound): GraphNode | undefined => {
    let hops = 0;
    for (let at = walked.parents.get(way.node.id)?.from; at !== undefined && hops < MOST_CHAIN_HOPS; at = walked.parents.get(at)?.from, hops += 1) {
      if (ownIds.has(at)) return undefined;
      const step = db.node(at);
      if (isBotFile(step)) return step;
    }
    return undefined;
  };
  // A route's kind, and the file of the code that handles it: a bot's webhook by the bot's code it hands updates to.
  const routeKind = (way: WayInFound): { kind: string; by?: GraphNode } => {
    if (isBotFile(way.by) || isBotFile(way.node)) return { kind: 'bots' };
    const bot = throughBot(way);
    if (bot !== undefined) return { kind: 'bots', by: bot };
    const role = classifyRoute(routeFactsOf(way.node, way.by?.label), options).role;
    return { kind: (role === undefined ? undefined : RECEIVER_KINDS[role]) ?? 'routes' };
  };
  for (const way of ways) {
    let kind = kindOfWay(way.node);
    let by = way.by;
    if (kind === 'routes') {
      if (way.via === undefined && own.has(way.node.repo) && requested.has(way.node.id)) {
        changing.push(way.node.id);
        continue;
      }
      const said = routeKind(way);
      kind = said.kind;
      by = said.by ?? by;
    }
    put(kind, way.node.repo, by?.file ?? way.node.file ?? way.node.label);
  }
  // The kinds of each service's ways in, for a maybe row whose file says none.
  let serviceKinds: Map<string, Set<string>> | undefined;
  const kindsOfService = (repo: string): Set<string> => {
    if (serviceKinds === undefined) {
      serviceKinds = new Map();
      for (const entry of db.nodesByType('entry')) serviceKinds.set(entry.repo, (serviceKinds.get(entry.repo) ?? new Set()).add(kindOfWay(entry)));
    }
    return serviceKinds.get(repo) ?? new Set();
  };
  for (const maybe of maybes) {
    const file = maybe.node.file ?? maybe.node.label;
    const kinds = kindsOfService(maybe.node.repo);
    const kind = isBotFile(maybe.node) ? 'bots' : kinds.size === 1 ? [...kinds][0]! : 'other';
    // Said once: a file a way in of the same kind already names is not said again as a maybe.
    if (groups.get(kind)?.get(maybe.node.repo)?.has(file) === true) continue;
    put(kind, maybe.node.repo, `${file} (maybe)`);
  }
  const sorted = <T>(entries: Iterable<[string, T]>): Array<[string, T]> => [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const byKind = Object.fromEntries(
    sorted(groups).map(([kind, services]) => [kind, Object.fromEntries(sorted(services).map(([repo, files]) => [repo, [...files].sort()]))]),
  );
  return {
    ...(groups.size === 0 ? {} : { byKind }),
    ...(changing.length === 0 ? {} : { changing: changing.sort() }),
  };
};

/**
 * Every way in that could break if a symbol changes (P367), answered once for
 * the tool and the command line (P370): one walk, `waysIn`, back past every
 * way in, each row with the crossing it came through and whether it runs, then
 * the chains an unread call stops as maybe rows. Several symbols are one
 * change (P381): one walk from all of them, every way in once; a name that
 * means two or three nodes answers each.
 */
export const impactOf = (db: GraphDb, handle: Pick<DbHandle, 'config' | 'path'>, input: ImpactInput): ImpactOf => {
  const { detail } = bound(input);
  const asked = askedOf(input.symbol, input.symbols);
  if (asked.length === 0) return { answer: { error: 'ask with symbol or symbols' }, detail };
  const retry = (id: string): string => callOf('impact', { symbol: id, callersIn: input.callersIn });
  if (asked.length === 1) {
    const found = resolveSymbol(db, asked[0]!, input.service);
    if (isResolved(found)) return impactOn(db, handle, input, [found], []);
    const reader = reachReader(db, handle, detail);
    const one = (id: string): object => impactOn(db, handle, { ...input, symbol: id, symbols: undefined }, [{ id, node: db.node(id)! }], []).answer;
    return { answer: candidatesEach(db, reader, found, asked[0]!, detail, one, retry), detail };
  }
  const founds: Resolved[] = [];
  const unresolved: Array<{ asked: string; answer: object }> = [];
  for (const symbol of asked) {
    const found = resolveSymbol(db, symbol, input.service);
    if (!isResolved(found)) unresolved.push({ asked: symbol, answer: candidatesAnswer(found, { symbol }, detail, retry) });
    else if (!founds.some((known) => known.id === found.id)) founds.push(found);
  }
  if (founds.length === 0) return { answer: answerEach('symbol', asked, (symbol) => unresolved.find((item) => item.asked === symbol)!.answer), detail };
  return impactOn(db, handle, input, founds, unresolved);
};

/** impact on the symbols resolved, as one change; those that resolved to no one node said apart (P381). */
const impactOn = (
  db: GraphDb,
  handle: Pick<DbHandle, 'config' | 'path'>,
  input: ImpactInput,
  founds: readonly Resolved[],
  unresolved: ReadonlyArray<{ asked: string; answer: object }>,
): ImpactOf => {
  const { detail, maxNodes, note } = bound(input);
  const targets = founds.map((found) => found.node);
  const target = targets[0]!;
  const single = targets.length === 1;
  const reader = reachReader(db, handle, detail);

  // A class answers for its methods (P95): calls point at them, never at it.
  const startSets = targets.map((each) => startsOf(db, each));
  const forClass = single && startSets[0]!.forClass;
  const starts = startSets.flatMap((set, at) => (set.forClass ? set.starts : [targets[at]!]));
  const ownIds = new Set([...targets.map((each) => each.id), ...startSets.flatMap((set) => set.starts.map((start) => start.id))]);
  // Back from the target past every way in to the callers beyond it (P367): a
  // screen that shows the component whose method requests the route, a bot
  // command whose handler does, each with the crossing it came through.
  const walked = reader.waysIn(starts, IMPACT_WALK_NODES);
  // `service` picks the symbol (P381); the rows are cut only by `callersIn`, or by a service the symbol lies outside.
  const rowsIn = rowsInOf(targets, input.service, input.callersIn);
  const inScope = inService(rowsIn);
  // What publishes to a channel a consumer on the way takes messages from calls none of the code (P372): walked on
  // from by channel, said apart, and listed only when that channel is asked for.
  const crossed = throughChannelsOf(db, reader, walked, (way) => !ownIds.has(way.node.id) && inScope(way.node));
  const throughs = crossed.filter((through) => through.ways.length > 0);
  const channels = new Set<string>();
  // Every channel a consumer on the way takes messages from, whether or not a way in lies beyond it.
  for (const { from } of walked.crossings) {
    channels.add(isMessageTypeNode(from) && typeof from.meta?.channel === 'string' ? from.meta.channel : from.id);
  }
  // What reaches it at all, beyond a channel too: a change is visible there, though nothing there calls it (R03).
  const reachedByService: Record<string, number> = {};
  let reached = 0;
  const counted = new Set<string>(ownIds);
  for (const node of [...walked.met, ...crossed.flatMap((through) => [through.from, ...through.walked.met])]) {
    if (counted.has(node.id)) continue;
    counted.add(node.id);
    reached += 1;
    reachedByService[node.repo] = (reachedByService[node.repo] ?? 0) + 1;
    if (node.type === 'channel') channels.add(node.id);
  }

  const entriesByService: Record<string, number> = {};
  let elsewhere = 0;
  const ways: WayInFound[] = [];
  // The services a way in was found in, in any service asked or not: the others are reached without one.
  const withEntry = new Set<string>();
  for (const through of crossed) {
    for (const way of through.walked.found) if (way.node.type === 'entry' && !ownIds.has(way.node.id)) withEntry.add(way.node.repo);
  }
  for (const way of walked.found) {
    // Its ways in are the rows: a consumer nothing read publishes to is walked past, and listed by its way in.
    if (ownIds.has(way.node.id) || way.node.type !== 'entry') continue;
    withEntry.add(way.node.repo);
    if (!inScope(way.node)) {
      elsewhere += 1;
      continue;
    }
    ways.push(withHandler(db, walked, way));
    entriesByService[way.node.repo] = (entriesByService[way.node.repo] ?? 0) + 1;
  }
  // A chain that ends before any way in, where an unread call could reach it: a maybe row, with the gap.
  const maybes = walked.tops.filter((top) => !ownIds.has(top.node.id) && inScope(top.node) && reader.maybeEnd(top.node));
  // A chain that ends at code whose name its repository writes nowhere else: no unread call could reach it, so no
  // way in could break through it (P370). Counted, not listed.
  const unreachedEnds = walked.tops.filter((top) => !ownIds.has(top.node.id) && inScope(top.node) && reader.unreachedEnd(top.node)).length;
  // Said once per consumer (P378): a consumer on several channels is one row, its ways in each counted once.
  const folded = throughByConsumer(throughs);
  // A channel asked lists the ways in beyond it; a consumer a row names, those beyond every channel of its row.
  const byChannel = input.channel === undefined ? undefined : throughs.filter((through) => isChannelAsked(through, input.channel!));
  const byConsumer =
    input.channel === undefined || byChannel!.length > 0 ? undefined : throughs.filter((through) => isConsumerAsked(through, input.channel!));
  const askedConsumer = byConsumer !== undefined && byConsumer.length > 0 ? byConsumer[0]!.consumer.id : undefined;
  const asked = askedConsumer === undefined ? byChannel : byConsumer;
  const acrossWays: WayInFound[] = [];
  for (const through of asked ?? []) {
    for (const way of through.ways) if (!acrossWays.some((known) => known.node.id === way.node.id)) acrossWays.push(way);
  }
  const listedWays = asked === undefined ? ways : acrossWays;
  const listedMaybes = asked === undefined ? maybes : [];
  const byId = (a: WayInFound, b: WayInFound): number => (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0);
  const listed = [...listedWays.sort(byId), ...listedMaybes.sort(byId)];

  // A change is visible in every service the chain runs into, whether or
  // not an entry point was found above it. Counting only the entry points
  // answered "one entry, in this service" for a change another repository
  // also reaches, which reads as "nothing outside this service".
  const servicesWithoutEntry = Object.keys(reachedByService)
    .filter((repo) => !withEntry.has(repo))
    .sort();

  const { items, total, truncated, nextOffset } = truncate(listed, maxNodes, input.offset);
  // How many of the rows listed, on any page, reach the target through each way in they cross (P375): a route the
  // screens and bots listed request is a way in itself, and the rows say which reach through it.
  const throughIt = new Map<string, number>();
  for (const way of listed) {
    const crossedId = way.via?.id;
    if (crossedId !== undefined && crossedId !== way.node.id) throughIt.set(crossedId, (throughIt.get(crossedId) ?? 0) + 1);
  }
  // Whether each way in runs (P364), the crossing it reaches the target through (P367), the code that handles it
  // (P374), and the rows that reach it through this one (P375).
  const rows = items.map((way) => {
    const row = reader.annotate(projectDetail(way.node, detail));
    if (detail < 1) return row;
    const viaIt = throughIt.get(way.node.id);
    return {
      ...row,
      ...(way.via === undefined ? {} : { via: viaSaid(way.via, way.node) }),
      ...(way.by === undefined ? {} : { by: way.by.id }),
      ...(viaIt === undefined ? {} : { rowsVia: viaIt }),
    };
  });
  const targetRow = (found: Resolved): object => {
    const { reach, throughDead } = detail < 1 ? {} : reader.of(found.node.id);
    return {
      ...projectDetail(found.node, detail),
      ...(reach === undefined ? {} : { reach }),
      // Dead only because every way in reaching it is (P381): said, so the target's reach does not contradict its rows.
      ...(throughDead === undefined ? {} : { throughDead }),
      ...(single || found.alsoAnswers === undefined ? {} : { alsoAnswers: found.alsoAnswers }),
    };
  };
  // The symbols as a call names them: one, or all of them as the one change they are.
  const symbolArgs = single ? { symbol: target.id } : { symbols: targets.map((each) => each.id) };
  const args = {
    ...symbolArgs,
    service: input.service,
    callersIn: input.callersIn,
    detail: input.detail,
    maxNodes,
    ...(input.channel === undefined ? {} : { channel: input.channel }),
  };
  // The walk's own limit is a cut, said where cuts are said (P94): it
  // used to be a note, which the detail clamp's note overwrote (P132).
  const walkCut = walked.cut
    ? `reachability stopped at the walk limit of ${IMPACT_WALK_NODES} nodes; entries past it are not listed`
    : undefined;
  const acrossCut = (asked ?? []).filter((through) => through.cut).map((through) => through.channel);
  const cuts = [...(nextOffset === undefined ? [] : [truncated!]), ...(walkCut === undefined ? [] : [walkCut])];
  // No way in, said rather than left as an empty list, with where to look (P94).
  const entriesNone =
    listedWays.length > 0
      ? undefined
      : asked !== undefined
        ? `no way in lies beyond a channel ${input.channel} on the way to this; throughChannels names those that do`
        : elsewhere > 0
          ? `no way in of ${rowsIn ?? ''} reaches this; ${elsewhere} in other services do`
          : throughs.length > 0
            ? beyondSaid(distinctWays(throughs).length)
            : reached > 0
              ? 'nothing in the graph reaches this from a way in; the callers may be behind a gap'
              : 'nothing reaches this';
  // The ways in beyond the first channel, one call away (P372).
  const across = asked === undefined && folded.length > 0 ? [acrossCall(symbolArgs, folded[0]!)] : [];
  // What the filter left out, one call away: the same symbols with no filter (P381).
  const unfiltered = elsewhere > 0 ? [callOf('impact', symbolArgs)] : [];
  const leads =
    asked !== undefined
      ? [callOf('impact', symbolArgs)]
      : entriesNone === undefined
        ? [...across, ...unfiltered, ...nextFor(items[0]?.node)]
        : [
            ...across,
            ...unfiltered,
            // Deeper callers only where something reaches it at all.
            ...(reached > 0 && maybes.length === 0 && throughs.length === 0
              ? [callOf('who_calls', { ...symbolArgs, depth: 8 }, { ...COMMON_DEFAULTS, depth: DEFAULT_CALLER_DEPTH })]
              : []),
            ...gapLeads(target),
          ];
  const fuzzy = single && founds[0]!.fuzzy === true;
  const docs = single ? withDocs(db, handle.path, target.id) : docsOfAll(db, handle.path, targets);
  const answer = withNext({
    ...(single ? { target: targetRow(founds[0]!) } : { targets: founds.map(targetRow) }),
    ...(fuzzy ? { fuzzy: true } : {}),
    ...(single && founds[0]!.alsoAnswers !== undefined ? { alsoAnswers: founds[0]!.alsoAnswers } : {}),
    ...(forClass ? { forMethods: startSets[0]!.starts.length } : {}),
    // A symbol of several that names no one node: its candidates, or that nothing matches it.
    ...(unresolved.length === 0 ? {} : { unresolved: unresolved.map((item) => ({ asked: item.asked, ...item.answer })) }),
    ...(asked === undefined ? {} : askedConsumer === undefined ? { acrossChannel: input.channel } : { acrossConsumer: askedConsumer }),
    entries: rows,
    total,
    ...(cuts.length === 0 ? {} : { truncated: cuts.join('; ') }),
    ...(nextOffset === undefined ? {} : { nextOffset }),
    ...(entriesNone === undefined ? {} : { entriesNone }),
    // Every way in that breaks, on any page, by kind with the files handling them; the routes it runs behind apart (P381).
    ...(asked === undefined ? byKindOf(db, handle, ways, maybes, targets, walked, ownIds) : {}),
    // How many things reach it at all, so no entry points is telling
    // rather than indistinguishable from nothing reaching it.
    reached,
    entriesByService:
      asked === undefined
        ? entriesByService
        : acrossWays.reduce<Record<string, number>>((counts, way) => ({ ...counts, [way.node.repo]: (counts[way.node.repo] ?? 0) + 1 }), {}),
    ...(listedMaybes.length === 0 ? {} : { maybe: listedMaybes.length }),
    ...(unreachedEnds === 0 || asked !== undefined ? {} : { unreached: unreachedEnds }),
    // Reached only across a channel: counted by channel, never complete-blocking (P372).
    ...(asked !== undefined || folded.length === 0 ? {} : { throughChannels: folded.map((through) => throughRow(through, true)) }),
    reachedByService,
    servicesWithoutEntry,
    channels: [...channels].sort(),
    // The pages about it (P120): what to update beside what to retest.
    ...docs,
    ...completeOf([
      fuzzy && fuzzyLeft(input.symbol ?? target.id, 1),
      ...unresolved.map((item) => {
        const candidates = (item.answer as { candidates?: unknown[] }).candidates;
        return `symbol ${item.asked}: ${candidates === undefined ? 'not found' : `names ${candidates.length} nodes, see unresolved`}`;
      }),
      pageLeft(total, items.length, input.offset ?? 0, nextOffset),
      asked === undefined && filterLeft(elsewhere, rowsIn, input.callersIn),
      walkCut !== undefined && `walk: stopped at ${IMPACT_WALK_NODES} nodes; ways in past it not listed`,
      acrossCut.length > 0 && `walk: stopped at ${CHANNEL_WALK_NODES} nodes beyond ${acrossCut.join(', ')}; ways in past it not listed`,
      listedMaybes.length > 0 &&
        `gaps: ${listedMaybes.length} chain${listedMaybes.length === 1 ? ' stops' : 's stop'} at an unread call before any way in: the maybe row${listedMaybes.length === 1 ? '' : 's'}`,
      entriesNone !== undefined &&
        asked === undefined &&
        reached > 0 &&
        elsewhere === 0 &&
        maybes.length === 0 &&
        throughs.length === 0 &&
        unreachedEnds < walked.tops.length &&
        'gaps: something reaches it but no way in does; its callers may be behind a gap',
      ...reader.left(),
    ]),
    ...(note === undefined ? {} : { note }),
  }, pagedNext({ tool: 'impact', args, nextOffset }, withoutShown(leads, rows)));
  return {
    answer,
    detail,
    target,
    starts,
    walked: asked === undefined ? walked : joinedWalk(walked, asked),
    listed: items,
    ways: listedWays,
    maybes: listedMaybes,
    servicesWithoutEntry,
    throughChannels: asked ?? throughs,
  };
};

/** The pages about any of several symbols (P120), each once. */
const docsOfAll = (db: GraphDb, path: string, targets: readonly GraphNode[]): { docs?: unknown[] } => {
  const seen = new Set<string>();
  const docs: unknown[] = [];
  for (const target of targets) {
    for (const doc of withDocs(db, path, target.id).docs ?? []) {
      const key = JSON.stringify(doc);
      if (seen.has(key)) continue;
      seen.add(key);
      docs.push(doc);
    }
  }
  return docs.length === 0 ? {} : { docs };
};

/** One symbol the ways in are walked to, and how a row of `waysIn` names it in `reaches`. */
interface CallersGroup {
  said: string;
  start: GraphNode;
  /** The symbol asked and the start: never a way in of its own walk. */
  own: ReadonlySet<string>;
}

/**
 * What who_calls walks to the ways in from (P376): each symbol asked, and for
 * a class each of its methods something calls, so a way in names which of
 * them it reaches. A class asked alone names its methods by their own names.
 */
const groupsOf = (db: GraphDb, target: GraphNode, alone: boolean): CallersGroup[] => {
  const { starts, forClass } = startsOf(db, target);
  if (!forClass) return [{ said: target.label, start: target, own: new Set([target.id]) }];
  const prefix = `${target.label}.`;
  return starts.map((start) => ({
    said: alone && start.label.startsWith(prefix) ? start.label.slice(prefix.length) : start.label,
    start,
    own: new Set([target.id, start.id]),
  }));
};

/** A row of who_calls's `waysIn`, `maybe` or `throughChannels`, and the symbols asked it reaches. */
interface Reaching<T> {
  item: T;
  reaches: Set<string>;
}

interface CallersWaysIn {
  ways: Array<Reaching<WayInFound>>;
  maybes: Array<Reaching<WayInFound>>;
  unreached: number;
  /** The other ends of chains with no way in above them, nearest first: code nothing read calls, judged neither. */
  ends: GraphNode[];
  /** Said once per consumer (P378). */
  throughs: Array<Reaching<ThroughConsumer>>;
  /** The ways in beyond any channel, each once. */
  beyond: number;
  /** A walk stopped at its bound: ways in past it are not listed. */
  cut: boolean;
  /** Symbols not walked from: the walks before them read `CALLERS_WALK_TOTAL` nodes. */
  unwalked: string[];
  groups: number;
  /** The ways in the service filter left out (P381), each once. */
  filtered: number;
}

/**
 * Every way in that reaches the symbols asked, each once (P376), read by the
 * walk impact reads them by (`waysIn`, P367 and P372): back past every way in
 * to the callers beyond it, never along a navigation or across a channel a
 * consumer on the way takes messages from, those channels counted apart. One
 * walk per symbol, so each way in says which of them it reaches; a chain that
 * ends before any way in, where an unread call could reach it, is a maybe.
 */
const callersWaysIn = (db: GraphDb, reader: ReachReader, groups: readonly CallersGroup[], keep: (node: GraphNode) => boolean): CallersWaysIn => {
  const ways = new Map<string, Reaching<WayInFound>>();
  const maybes = new Map<string, Reaching<WayInFound>>();
  const unreached = new Set<string>();
  const ends = new Map<string, GraphNode>();
  const crossedBy = new Map<string, Set<string>>();
  const found: WayInFound[] = [];
  const crossings: Walked['crossings'] = [];
  const unwalked: string[] = [];
  const filtered = new Set<string>();
  let left = CALLERS_WALK_TOTAL;
  let cut = false;
  const add = (into: Map<string, Reaching<WayInFound>>, way: WayInFound, said: string): void => {
    const known = into.get(way.node.id);
    if (known === undefined) into.set(way.node.id, { item: way, reaches: new Set([said]) });
    else {
      known.reaches.add(said);
      if (way.depth < known.item.depth) known.item = way;
    }
  };
  for (const group of groups) {
    if (left <= 0) {
      unwalked.push(group.said);
      continue;
    }
    const walked = reader.waysIn([group.start], Math.min(IMPACT_WALK_NODES, left));
    left -= walked.read;
    cut ||= walked.cut;
    for (const way of walked.found) {
      if (way.node.type !== 'entry' || group.own.has(way.node.id)) continue;
      if (!keep(way.node)) {
        filtered.add(way.node.id);
        continue;
      }
      add(ways, withHandler(db, walked, { ...way }), group.said);
    }
    for (const top of walked.tops) {
      if (group.own.has(top.node.id) || !keep(top.node)) continue;
      if (reader.maybeEnd(top.node)) add(maybes, top, group.said);
      else if (reader.unreachedEnd(top.node)) unreached.add(top.node.id);
      else if (!ends.has(top.node.id)) ends.set(top.node.id, top.node);
    }
    found.push(...walked.found);
    for (const crossing of walked.crossings) {
      crossings.push(crossing);
      crossedBy.set(crossing.from.id, (crossedBy.get(crossing.from.id) ?? new Set()).add(group.said));
    }
  }
  const owns = new Set(groups.flatMap((group) => [...group.own]));
  // The channels every walk did not cross, each walked on from once.
  const merged: Walked = { found, tops: [], met: [], parents: new Map(), crossings, read: 0, cut: false };
  const crossed = throughChannelsOf(db, reader, merged, (way) => !owns.has(way.node.id) && !ways.has(way.node.id) && keep(way.node)).filter(
    (through) => through.ways.length > 0,
  );
  // One row per consumer (P378), reaching every symbol any of its channels was crossed from.
  const throughs = throughByConsumer(crossed).map((through) => ({
    item: through,
    reaches: new Set(through.throughs.flatMap((row) => [...(crossedBy.get(row.from.id) ?? [])])),
  }));
  const byNear = (a: Reaching<WayInFound>, b: Reaching<WayInFound>): number => byDepthThenId(a.item, b.item);
  return {
    ways: [...ways.values()].sort(byNear),
    maybes: [...maybes.values()].sort(byNear),
    unreached: unreached.size,
    ends: [...ends.values()],
    throughs,
    beyond: distinctWays(crossed).length,
    cut,
    unwalked,
    groups: groups.length,
    filtered: filtered.size,
  };
};

/** The symbols asked a row reaches, said only where it reaches some of several. */
const reachesSaid = (reaches: ReadonlySet<string>, groups: number): { reaches?: string[] } =>
  groups > 1 && reaches.size < groups ? { reaches: [...reaches].sort() } : {};

/** who_calls's ways in, maybe ends and channels as an answer says them, and what they leave out (P376). */
const callersWaysInSaid = (
  found: CallersWaysIn,
  reader: ReachReader,
  detail: 0 | 1 | 2 | 3,
  filter: { rowsIn?: string | undefined; callersIn?: string | undefined } = {},
): { fields: Record<string, unknown>; left: string[]; first?: GraphNode; maybeTop?: GraphNode; through?: ThroughConsumer } => {
  const maybes = found.maybes.length;
  const { beyond } = found;
  // No way in, said rather than left as an empty list, as impact says it (P94); never "nothing" where a filter cut (P381).
  const none =
    found.ways.length > 0
      ? undefined
      : found.filtered > 0
        ? `no way in of ${filter.rowsIn ?? ''} reaches this; ${found.filtered} in other services do`
        : beyond > 0
        ? beyondSaid(beyond)
        : maybes > 0
          ? 'no way in reaches this; the maybe rows stop at an unread call'
          : found.ends.length > 0 || found.unreached > 0
            ? 'nothing in the graph reaches this from a way in; the callers may be behind a gap'
            : 'nothing reaches this';
  const behindGap = none !== undefined && found.filtered === 0 && beyond === 0 && maybes === 0 && found.ends.length > 0;
  const waysIn = found.ways.map(({ item, reaches }) => ({
    ...reader.annotate(projectDetail(item.node, detail)),
    hops: item.depth,
    ...(detail < 1 || item.by === undefined ? {} : { by: item.by.id }),
    ...reachesSaid(reaches, found.groups),
  }));
  const maybe = found.maybes.map(({ item, reaches }) => ({
    ...reader.annotate(projectDetail(item.node, detail)),
    hops: item.depth,
    ...reachesSaid(reaches, found.groups),
  }));
  // Who calls the code is the question: what lies past a channel is counted, the impact call in `next` lists it (P378).
  const throughs = found.throughs.map(({ item, reaches }) => ({ ...throughRow(item, false), ...reachesSaid(reaches, found.groups) }));
  return {
    fields: {
      waysIn,
      ...(none === undefined ? {} : { waysInNone: none }),
      ...(maybes === 0 ? {} : { maybe }),
      ...(found.unreached === 0 ? {} : { unreached: found.unreached }),
      ...(throughs.length === 0 ? {} : { throughChannels: throughs }),
    },
    left: [
      ...[filterLeft(found.filtered, filter.rowsIn, filter.callersIn)].filter((item): item is string => item !== false),
      ...(found.cut ? [`walk: stopped at ${IMPACT_WALK_NODES} nodes; ways in past it not listed`] : []),
      ...(found.unwalked.length === 0 ? [] : [`walk: not walked from ${found.unwalked.join(', ')}, past ${CALLERS_WALK_TOTAL} nodes read`]),
      ...(maybes === 0 ? [] : [`gaps: ${maybes} chain${maybes === 1 ? ' stops' : 's stop'} at an unread call before any way in: the maybe row${maybes === 1 ? '' : 's'}`]),
      ...(behindGap ? ['gaps: something reaches it but no way in does; its callers may be behind a gap'] : []),
    ],
    ...(found.ways[0] === undefined ? {} : { first: found.ways[0].item.node }),
    ...(found.maybes[0] === undefined ? (found.ends[0] === undefined ? {} : { maybeTop: found.ends[0] }) : { maybeTop: found.maybes[0].item.node }),
    ...(found.throughs[0] === undefined ? {} : { through: found.throughs[0].item }),
  };
};

export const registerReach = (server: McpServer, ctx: ToolContext): void => {
  /**
   * One symbol's callers (who_calls), with each row's reach (P364): the tree
   * to `depth` (unset, its first hops) and every way in past it (P376, P379),
   * unless `shared`: several symbols asked together say their ways in once,
   * for all of them. The depth is how far the tree is drawn, never a cut: the
   * ways in past it are listed whatever it is.
   */
  const whoCallsOne = (db: GraphDb, input: WhoCallsAsked, symbol: string, reader: ReachReader, shared = false): object => {
    const { detail, maxNodes, note } = bound(input);
    const defaults = { ...COMMON_DEFAULTS, depth: undefined };
    const found = resolveSymbol(db, symbol, input.service);
    if (!isResolved(found)) {
      const retry = (id: string): string => callOf('who_calls', { symbol: id, depth: input.depth, callersIn: input.callersIn }, defaults);
      // Several symbols asked: the name's candidates, the call to make for each. One: two or three each answered (P381).
      if (shared) return candidatesAnswer(found, { symbol }, detail, retry);
      return candidatesEach(db, reader, found, symbol, detail, (id) => whoCallsOne(db, input, id, reader), retry);
    }
    const target = found.node;
    // `service` picked the symbol (P381): the rows are cut only by `callersIn`, or by a service the symbol lies outside.
    const rowsIn = rowsInOf([target], input.service, input.callersIn);
    const near = input.depth ?? (shared || startsOf(db, target).forClass ? NEAR_CALLER_DEPTH_SEVERAL : NEAR_CALLER_DEPTH);

    const walked = callersOf(db, target, near, maxNodes, detail);
    const callers = keepService(db, walked.callers, rowsIn);
    const firstEntry = findFirst(callers, (item) => item.node.type === 'entry');
    const counts = loadObservedCounts(ctx.handle.path);
    if (counts !== undefined) markObserved(counts, target.id, callers, 'backward');
    const seen = counts === undefined ? undefined : nodeRow(counts, target.id);
    const unsure = counts === undefined ? undefined : nodeAmbiguous(counts, target.id);
    // Whether each row runs and where it is reached from, the target first (P364).
    const { id: _target, ...targetReach } = reader.annotate({ id: target.id });
    annotateTree(callers, reader);

    // Walked to the ways in, the tree's depth line is where the rows stop being drawn, not a cut (P376, P379).
    const cutByNodes = walked.cutByNodes;
    const groups = groupsOf(db, target, !shared);
    const ways = shared
      ? undefined
      : callersWaysInSaid(callersWaysIn(db, reader, groups, inService(rowsIn)), reader, detail, { rowsIn, callersIn: input.callersIn });
    // A class's caller says the method it calls by the name `reaches` gives it, not its id again.
    if (groups.length > 1) {
      const said = new Map(groups.map((group) => [group.start.id, group.said]));
      for (const item of callers) if (item.calls !== undefined) item.calls = said.get(item.calls) ?? item.calls;
    }
    // The first chain the walk says may be reached through an unread call (a navigation onto the target, which a
    // tree draws, is no caller: P372); a chain top is a maybe only where an unread call could reach it, as impact says.
    const targetIsTop = walked.targetTop !== undefined;
    const top = targetIsTop ? target : ways?.maybeTop;
    const shown: RowShown[] = [{ id: target.id, label: target.label, ...targetReach }, ...rowsOf(callers)];
    const wayIn = ways === undefined ? firstEntry?.node : ways.first ?? firstEntry?.node;
    return withNext(
      {
        target: {
          ...projectDetail(target, detail),
          ...(seen === undefined ? {} : { observed: seen.hits, ...figuresOf(seen) }),
          ...(unsure === undefined ? {} : { seenAmbiguous: unsure }),
          ...targetReach,
          // Where the requests it sends land (P377): the route and its handler, or the address joined to none.
          ...requestsOf(db, target),
        },
        ...(found.fuzzy === true ? { fuzzy: true } : {}),
        ...(found.alsoAnswers === undefined ? {} : { alsoAnswers: found.alsoAnswers }),
        ...(found.channelUsed === undefined ? {} : { channelUsed: found.channelUsed }),
        // Nothing calls the target itself: a lead, not a verdict (D3).
        ...(targetIsTop ? { topOfChain: true, gapsInFile: walked.targetTop } : {}),
        callers: slimForest(callers, target.repo === '' ? undefined : target.repo),
        ...(ways?.fields ?? {}),
        ...(cutByNodes === 0
          ? {}
          : {
              truncated: truncationMessage(cutByNodes, true, { limit: 'maxNodes', at: maxNodes, tool: 'who_calls' }),
              stoppedBy: ['maxNodes'],
            }),
        ...completeOf([
          found.fuzzy === true && fuzzyLeft(symbol, 1),
          cutByNodes > 0 && `maxNodes: ${cutByNodes} callers cut`,
          targetIsTop && (walked.targetTop ?? 0) > 0 && `gaps: ${walked.targetTop} unread in its file, any may call it`,
          ...(ways?.left ?? []),
          ...(shared ? [] : reader.left()),
        ]),
        ...(note === undefined ? {} : { note }),
      },
      [
        ...withoutShown(
          [
            // The ways in past a channel, one call away (P372).
            ...(ways?.through === undefined ? [] : [acrossCall({ symbol: target.id }, ways.through)]),
            // What the filter left out, one call away: the same symbol with no filter (P381).
            ...(rowsIn !== undefined && (ways?.left ?? []).some((item) => item.startsWith('filter:'))
              ? [callOf('who_calls', { symbol: target.id, depth: input.depth }, defaults)]
              : []),
            ...(top === undefined ? [] : gapLeads(top)),
            // Not the call just made, which `nextFor` offers for any symbol.
            ...nextFor(wayIn, target).filter((hint) => !hint.startsWith(`who_calls({symbol: ${JSON.stringify(target.id)}`)),
          ],
          shown,
        ),
      ].slice(0, MAX_NEXT),
    );
  };

  /**
   * Several symbols walked to the ways in (P376): each symbol's direct
   * callers, and every way in once, saying which of the symbols it reaches
   * where it reaches only some.
   */
  const whoCallsSeveral = (db: GraphDb, input: WhoCallsAsked, asked: readonly string[], reader: ReachReader): object => {
    const { detail } = bound(input);
    const each = answerEach('symbol', asked, (symbol) => whoCallsOne(db, input, symbol, reader, true)) as {
      answers: object[];
      complete?: boolean;
      left?: string[];
      next?: string[];
    };
    const groups: CallersGroup[] = [];
    const targets = new Set<string>();
    const nodes: GraphNode[] = [];
    for (const symbol of asked) {
      const found = resolveSymbol(db, symbol, input.service);
      if (!isResolved(found)) continue;
      targets.add(found.node.id);
      nodes.push(found.node);
      groups.push(...groupsOf(db, found.node, false));
    }
    const rowsIn = rowsInOf(nodes, input.service, input.callersIn);
    const ways = callersWaysInSaid(callersWaysIn(db, reader, groups, inService(rowsIn)), reader, detail, { rowsIn, callersIn: input.callersIn });
    const left = [...(each.left ?? []), ...ways.left, ...reader.left()];
    const leads = [
      ...(ways.through === undefined || groups.length !== 1 ? [] : [acrossCall({ symbol: groups[0]!.start.id }, ways.through)]),
      ...(ways.maybeTop === undefined ? [] : gapLeads(ways.maybeTop)),
      ...nextFor(ways.first),
    ];
    // The ways in are said for every symbol asked: who_calls on one of them again would only repeat it (P379).
    const again = (hint: string): boolean => [...targets].some((id) => hint.startsWith(`who_calls({symbol: ${JSON.stringify(id)}`));
    const next = [...new Set([...leads, ...(each.next ?? [])])].filter((hint) => !again(hint)).slice(0, MAX_NEXT);
    return {
      // An answer's own `complete: true` is the whole call's; one cut says `left`, which the call's `left` points at.
      answers: each.answers.map((answer) => {
        const { complete, ...rest } = answer as { complete?: boolean };
        return complete === true ? rest : answer;
      }),
      ...ways.fields,
      ...completeOf(left),
      ...(next.length === 0 ? {} : { next }),
    };
  };

  server.registerTool(
    'who_calls',
    {
      title: 'Who calls this',
      description:
        'What reaches a symbol, across repositories to every way in (`waysIn`); a class: its methods. A route said aloud (`GET /orders/123`) is the most specific route (others: `alsoAnswers`). `service` picks the symbol; `callersIn` keeps one service.',
      inputSchema: {
        symbol: z.string().optional(),
        symbols: severalInput(),
        depth: z.number().int().min(1).max(MAX_CALLER_DEPTH).optional().describe('tree hops'),
        service: serviceInput,
        callersIn: serviceInput,
        ...commonInput,
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const asked = askedOf(input.symbol, input.symbols);
        if (asked.length === 0) return { error: 'ask with symbol or symbols' };
        const reader = reachReader(db, ctx.handle, bound(input).detail);
        if (asked.length === 1) return whoCallsOne(db, input, asked[0]!, reader);
        return whoCallsSeveral(db, input, asked, reader);
      }),
  );

  server.registerTool(
    'impact',
    {
      title: 'Blast radius',
      description:
        'Every way in whose code calls a symbol or `symbols` (one change): `byKind` sums them, `changing` the routes it runs behind; `by` the code handling one, `via` the listed route it goes through; `maybe`: an unread call; `throughChannels`: past a channel. `service` picks the symbol.',
      inputSchema: {
        symbol: z.string().optional(),
        symbols: severalInput(),
        channel: z.string().optional().describe('one of throughChannels'),
        service: serviceInput,
        callersIn: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      annotations: READ_ONLY,
    },
    (input) => withDb(ctx.handle, (db) => impactOf(db, ctx.handle, input).answer),
  );
};
