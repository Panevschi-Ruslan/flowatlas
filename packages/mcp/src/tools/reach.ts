import { isMessageTypeNode, wasMissed, type GraphNode } from '@flowatlas/core';
import { methodsOf, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, projectEdge, truncate } from '../query/detail.js';
import { isResolved, resolveSymbol, type EntryRef } from '../query/entry-ref.js';
import { requestsOf } from '../query/requests.js';
import { REVERSE_EDGES } from '../query/flow.js';
import { truncationMessage, type FlowNode } from '../query/types.js';
import { MAX_NEXT, nextFor, withNext, withoutShown, type RowShown } from '../query/next.js';
import { annotateTree, handledBy, reachReader, viaSaid, type ReachReader, type Walked, type WalkedFrom, type WayInFound } from '../query/ways-in.js';
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
  service?: string | undefined;
  detail: number;
  maxNodes: number;
}

/** What impact is asked: the tool's input, which the command line hands it too (P370). */
export interface ImpactInput {
  symbol: string;
  service?: string | undefined;
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
const acrossCall = (symbol: string, through: ThroughConsumer): string =>
  callOf('impact', { symbol, channel: through.channels.length === 1 ? through.channels[0]!.channel : through.consumer.id });

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
 * Every way in that could break if a symbol changes (P367), answered once for
 * the tool and the command line (P370): one walk, `waysIn`, back past every
 * way in, each row with the crossing it came through and whether it runs, then
 * the chains an unread call stops as maybe rows.
 */
export const impactOf = (db: GraphDb, handle: Pick<DbHandle, 'config' | 'path'>, input: ImpactInput): ImpactOf => {
  const { detail, maxNodes, note } = bound(input);
  const found = resolveSymbol(db, input.symbol);
  if (!isResolved(found)) {
    return { answer: candidatesAnswer(found, input, detail, (id) => callOf('impact', { symbol: id, service: input.service })), detail };
  }
  const target = found.node;
  const reader = reachReader(db, handle, detail);

  // A class answers for its methods (P95): calls point at them, never at it.
  const { starts, forClass } = startsOf(db, target);
  const ownIds = new Set([target.id, ...starts.map((start) => start.id)]);
  // Back from the target past every way in to the callers beyond it (P367): a
  // screen that shows the component whose method requests the route, a bot
  // command whose handler does, each with the crossing it came through.
  const walked = reader.waysIn(forClass ? starts : [target], IMPACT_WALK_NODES);
  const inScope = inService(input.service);
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
    const crossed = way.via?.id;
    if (crossed !== undefined && crossed !== way.node.id) throughIt.set(crossed, (throughIt.get(crossed) ?? 0) + 1);
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
  const targetReach = detail < 1 ? undefined : reader.of(target.id).reach;
  const args = { symbol: target.id, service: input.service, detail: input.detail, maxNodes, ...(input.channel === undefined ? {} : { channel: input.channel }) };
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
          ? `no way in of ${input.service ?? ''} reaches this; ${elsewhere} in other services do`
          : throughs.length > 0
            ? beyondSaid(distinctWays(throughs).length)
            : reached > 0
              ? 'nothing in the graph reaches this from a way in; the callers may be behind a gap'
              : 'nothing reaches this';
  // The ways in beyond the first channel, one call away (P372).
  const across = asked === undefined && folded.length > 0 ? [acrossCall(target.id, folded[0]!)] : [];
  const leads =
    asked !== undefined
      ? [callOf('impact', { symbol: target.id })]
      : entriesNone === undefined
        ? [...across, ...nextFor(items[0]?.node)]
        : [
            ...across,
            ...(elsewhere > 0 ? [callOf('impact', { symbol: target.id })] : []),
            // Deeper callers only where something reaches it at all.
            ...(reached > 0 && maybes.length === 0 && throughs.length === 0
              ? [callOf('who_calls', { symbol: target.id, depth: 8 }, { ...COMMON_DEFAULTS, depth: DEFAULT_CALLER_DEPTH })]
              : []),
            ...gapLeads(target),
          ];
  const answer = withNext({
    target: { ...projectDetail(target, detail), ...(targetReach === undefined ? {} : { reach: targetReach }) },
    ...(found.alsoAnswers === undefined ? {} : { alsoAnswers: found.alsoAnswers }),
    ...(forClass ? { forMethods: starts.length } : {}),
    ...(asked === undefined ? {} : askedConsumer === undefined ? { acrossChannel: input.channel } : { acrossConsumer: askedConsumer }),
    entries: rows,
    total,
    ...(cuts.length === 0 ? {} : { truncated: cuts.join('; ') }),
    ...(nextOffset === undefined ? {} : { nextOffset }),
    ...(entriesNone === undefined ? {} : { entriesNone }),
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
    ...withDocs(db, handle.path, target.id),
    ...completeOf([
      pageLeft(total, items.length, input.offset ?? 0, nextOffset),
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
    starts: forClass ? starts : [target],
    walked: asked === undefined ? walked : joinedWalk(walked, asked),
    listed: items,
    ways: listedWays,
    maybes: listedMaybes,
    servicesWithoutEntry,
    throughChannels: asked ?? throughs,
  };
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
      if (way.node.type !== 'entry' || group.own.has(way.node.id) || !keep(way.node)) continue;
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
): { fields: Record<string, unknown>; left: string[]; first?: GraphNode; maybeTop?: GraphNode; through?: ThroughConsumer } => {
  const maybes = found.maybes.length;
  const { beyond } = found;
  // No way in, said rather than left as an empty list, as impact says it (P94).
  const none =
    found.ways.length > 0
      ? undefined
      : beyond > 0
        ? beyondSaid(beyond)
        : maybes > 0
          ? 'no way in reaches this; the maybe rows stop at an unread call'
          : found.ends.length > 0 || found.unreached > 0
            ? 'nothing in the graph reaches this from a way in; the callers may be behind a gap'
            : 'nothing reaches this';
  const behindGap = none !== undefined && beyond === 0 && maybes === 0 && found.ends.length > 0;
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
    const found = resolveSymbol(db, symbol);
    if (!isResolved(found)) {
      return candidatesAnswer(found, { symbol }, detail, (id) =>
        callOf('who_calls', { symbol: id, depth: input.depth, service: input.service }, defaults),
      );
    }
    const target = found.node;
    const near = input.depth ?? (shared || startsOf(db, target).forClass ? NEAR_CALLER_DEPTH_SEVERAL : NEAR_CALLER_DEPTH);

    const walked = callersOf(db, target, near, maxNodes, detail);
    const callers = keepService(db, walked.callers, input.service);
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
    const ways = shared ? undefined : callersWaysInSaid(callersWaysIn(db, reader, groups, inService(input.service)), reader, detail);
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
            ...(ways?.through === undefined ? [] : [acrossCall(target.id, ways.through)]),
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
    for (const symbol of asked) {
      const found = resolveSymbol(db, symbol);
      if (!isResolved(found)) continue;
      targets.add(found.node.id);
      groups.push(...groupsOf(db, found.node, false));
    }
    const ways = callersWaysInSaid(callersWaysIn(db, reader, groups, inService(input.service)), reader, detail);
    const left = [...(each.left ?? []), ...ways.left, ...reader.left()];
    const leads = [
      ...(ways.through === undefined || groups.length !== 1 ? [] : [acrossCall(groups[0]!.start.id, ways.through)]),
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
        'What reaches a symbol, back across repositories to every way in (`waysIn`); on a class, its methods. A route said aloud (`GET /orders/123`) is the most specific route, the others under `alsoAnswers`.',
      inputSchema: {
        symbol: z.string().optional().describe('node id or name'),
        symbols: severalInput(),
        depth: z.number().int().min(1).max(MAX_CALLER_DEPTH).optional().describe('tree hops'),
        service: serviceInput,
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
        'Every way in whose code calls a symbol, in any service, each with `by`, the code handling it (not a way in); a row reaching it through a listed route names that route in `via`, the route counts them in `rowsVia`; a chain stopped by an unread call is a `maybe` row; ways in only past a channel are counted in `throughChannels`. Detail 1 is enough.',
      inputSchema: {
        symbol: z.string().describe('node id or name'),
        channel: z.string().optional().describe('list one of throughChannels, by channel or consumer'),
        service: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      annotations: READ_ONLY,
    },
    (input) => withDb(ctx.handle, (db) => impactOf(db, ctx.handle, input).answer),
  );
};
