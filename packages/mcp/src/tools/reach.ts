import { wasMissed, type GraphNode } from '@flowatlas/core';
import { methodsOf, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, projectEdge, truncate } from '../query/detail.js';
import { isResolved, resolveSymbol, type EntryRef } from '../query/entry-ref.js';
import { REVERSE_EDGES } from '../query/flow.js';
import { truncationMessage, type FlowNode, type WalkLimit } from '../query/types.js';
import { MAX_NEXT, nextFor, withNext, withoutShown, type RowShown } from '../query/next.js';
import { annotateTree, reachReader, viaSaid, type ReachReader, type WayInFound } from '../query/ways-in.js';
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
const DEFAULT_CALLER_DEPTH = 3;

/** How many rows on the depth line an answer names, so the walk can be asked on from them. */
const MAX_FRONTIER = 8;

/** The most nodes impact's walk reads before it stops and says so. */
const IMPACT_WALK_NODES = 4000;

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
  /** Rows each limit left out (P92's `stoppedBy` order: the one that left out more first). */
  cut: Record<'depth' | 'maxNodes', number>;
  /** Rows on the depth line with callers past it, at most `MAX_FRONTIER`. */
  frontier: string[];
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
 * the ones that survive a cut. A row on the depth line counts the callers it
 * did not follow (P94), so a tree cut by depth never reads as one that ran out
 * of callers; a row nothing calls is the top of its chain and says so.
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
  const cut = { depth: 0, maxNodes: 0 };
  const frontier: string[] = [];
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
    const open = edges.filter((edge) => !item.path.has(edge.from));

    if (item.level >= depth) {
      if (open.length === 0) continue;
      cut.depth += open.length;
      if (frontier.length < MAX_FRONTIER) frontier.push(item.node.id);
      continue;
    }

    for (const edge of open) {
      if (used >= maxNodes) {
        cut.maxNodes += 1;
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

  return { callers: roots, cut, frontier, ...(targetTop === undefined ? {} : { targetTop }) };
};

/** The limits that left rows out, the one that left out more first; a tie goes to maxNodes, as in get_flow. */
const stoppedByOf = (cut: Callers['cut']): WalkLimit[] =>
  (['maxNodes', 'depth'] as const).filter((limit) => cut[limit] > 0).sort((a, b) => cut[b] - cut[a]);

/** The sentence for the limit that left out more, with the advice that helps for it. */
const callersCutSaid = (cut: Callers['cut'], limit: WalkLimit, depth: number, maxNodes: number): string => {
  if (limit === 'depth' && depth >= MAX_CALLER_DEPTH) {
    return `${cut.depth} more nodes past depth ${depth}, the deepest; ask who_calls on an id in frontier`;
  }
  return limit === 'depth'
    ? truncationMessage(cut.depth, true, { limit: 'depth', at: depth })
    : truncationMessage(cut.maxNodes, true, { limit: 'maxNodes', at: maxNodes, tool: 'who_calls' });
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

/** How many rows of a tree are the top of a chain in a file with gaps: an unread call there may be their caller. */
const topsWithGaps = (nodes: readonly FlowNode[]): number =>
  nodes.reduce((sum, item) => sum + (item.topOfChain === true && (item.gapsInFile ?? 0) > 0 ? 1 : 0) + topsWithGaps(item.children), 0);

/** What who_calls was asked, less the symbol, which each answer of several takes in turn. */
interface WhoCallsAsked {
  depth: number;
  service?: string | undefined;
  detail: number;
  maxNodes: number;
}

export const registerReach = (server: McpServer, ctx: ToolContext): void => {
  /** One symbol's callers (who_calls), with each row's reach (P364). */
  const whoCallsOne = (db: GraphDb, input: WhoCallsAsked, symbol: string, reader: ReachReader): object => {
    const { detail, maxNodes, note } = bound(input);
    const defaults = { ...COMMON_DEFAULTS, depth: DEFAULT_CALLER_DEPTH };
    const found = resolveSymbol(db, symbol);
    if (!isResolved(found)) {
      return candidatesAnswer(found, { symbol }, detail, (id) =>
        callOf('who_calls', { symbol: id, depth: input.depth, service: input.service }, defaults),
      );
    }
    const target = found.node;

    const walked = callersOf(db, target, input.depth, maxNodes, detail);
    const callers = keepService(db, walked.callers, input.service);
    const firstEntry = findFirst(callers, (item) => item.node.type === 'entry');
    const counts = loadObservedCounts(ctx.handle.path);
    if (counts !== undefined) markObserved(counts, target.id, callers, 'backward');
    const seen = counts === undefined ? undefined : nodeRow(counts, target.id);
    const unsure = counts === undefined ? undefined : nodeAmbiguous(counts, target.id);
    // Whether each row runs and where it is reached from, the target first (P364).
    const { id: _target, ...targetReach } = reader.annotate({ id: target.id });
    annotateTree(callers, reader);

    const stoppedBy = stoppedByOf(walked.cut);
    const first = stoppedBy[0];
    const deeper = Math.min(MAX_CALLER_DEPTH, input.depth * 2);
    // The walk on first, where it stopped; then where a chain that ends in
    // nobody might be called from; then the ids the tree names.
    const goOn =
      first !== 'depth'
        ? []
        : input.depth < MAX_CALLER_DEPTH
          ? [callOf('who_calls', { symbol: target.id, depth: deeper, service: input.service }, defaults)]
          : walked.frontier.slice(0, 2).map((id) => callOf('who_calls', { symbol: id, depth: input.depth }, defaults));
    // The first chain that ends in nobody, among the rows kept.
    const targetIsTop = walked.targetTop !== undefined;
    const topRow = targetIsTop ? undefined : findFirst(callers, (item) => item.topOfChain === true);
    const top = targetIsTop ? target : topRow === undefined ? undefined : db.node(topRow.node.id);
    const tops = topsWithGaps(callers);
    const shown: RowShown[] = [{ id: target.id, label: target.label, ...targetReach }, ...rowsOf(callers)];
    return withNext(
      {
        target: {
          ...projectDetail(target, detail),
          ...(seen === undefined ? {} : { observed: seen.hits, ...figuresOf(seen) }),
          ...(unsure === undefined ? {} : { seenAmbiguous: unsure }),
          ...targetReach,
        },
        ...(found.alsoAnswers === undefined ? {} : { alsoAnswers: found.alsoAnswers }),
        ...(found.channelUsed === undefined ? {} : { channelUsed: found.channelUsed }),
        // Nothing calls the target itself: a lead, not a verdict (D3).
        ...(targetIsTop ? { topOfChain: true, gapsInFile: walked.targetTop } : {}),
        callers: slimForest(callers, target.repo === '' ? undefined : target.repo),
        ...(first === undefined
          ? {}
          : {
              truncated: callersCutSaid(walked.cut, first, input.depth, maxNodes),
              stoppedBy,
              ...(walked.cut.depth > 0 ? { frontier: walked.frontier } : {}),
            }),
        ...completeOf([
          walked.cut.depth > 0 && `depth: ${walked.cut.depth} callers past depth ${input.depth}, from the frontier rows`,
          walked.cut.maxNodes > 0 && `maxNodes: ${walked.cut.maxNodes} callers cut`,
          targetIsTop && (walked.targetTop ?? 0) > 0 && `gaps: ${walked.targetTop} unread in its file, any may call it`,
          tops > 0 && `gaps: ${tops} chain top${tops === 1 ? '' : 's'} sit${tops === 1 ? 's' : ''} in a file with unread calls`,
          ...reader.left(),
        ]),
        ...(note === undefined ? {} : { note }),
      },
      [
        ...goOn,
        ...withoutShown(
          [
            ...(top === undefined ? [] : gapLeads(top)),
            // Not the call just made, which `nextFor` offers for any symbol.
            ...nextFor(firstEntry?.node, target).filter((hint) => hint !== callOf('who_calls', { symbol: target.id })),
          ],
          shown,
        ),
      ].slice(0, MAX_NEXT),
    );
  };


  server.registerTool(
    'who_calls',
    {
      title: 'Who calls this',
      description:
        'What reaches a symbol, walked back across repositories; on a class, its methods. A route said aloud (`GET /orders/123`) is the most specific route, the others under `alsoAnswers`.',
      inputSchema: {
        symbol: z.string().optional().describe('node id or name'),
        symbols: severalInput(),
        depth: z.number().int().min(1).max(MAX_CALLER_DEPTH).default(DEFAULT_CALLER_DEPTH).describe('hops back'),
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
        return answerEach('symbol', asked, (symbol) => whoCallsOne(db, input, symbol, reader));
      }),
  );

  server.registerTool(
    'impact',
    {
      title: 'Blast radius',
      description:
        'Every way in that could break if a symbol changes, in any service: callers past a route or channel name it in `via`; a chain stopped by an unread call is a `maybe` row. Detail 1 is enough.',
      inputSchema: {
        symbol: z.string().describe('node id or name'),
        service: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const found = resolveSymbol(db, input.symbol);
        if (!isResolved(found)) {
          return candidatesAnswer(found, input, detail, (id) => callOf('impact', { symbol: id, service: input.service }));
        }
        const target = found.node;
        const reader = reachReader(db, ctx.handle, detail);

        // A class answers for its methods (P95): calls point at them, never at it.
        const { starts, forClass } = startsOf(db, target);
        const ownIds = new Set([target.id, ...starts.map((start) => start.id)]);
        // Back from the target past every way in to the callers beyond it (P367): a
        // screen that shows the component whose method requests the route, a bot
        // command whose handler does, each with the crossing it came through.
        const walked = reader.waysIn(forClass ? starts : [target], IMPACT_WALK_NODES);
        const channels = new Set<string>();
        const reachedByService: Record<string, number> = {};
        let reached = 0;
        for (const node of walked.met) {
          if (ownIds.has(node.id)) continue;
          reached += 1;
          reachedByService[node.repo] = (reachedByService[node.repo] ?? 0) + 1;
          if (node.type === 'channel') channels.add(node.id);
        }

        const inScope = inService(input.service);
        const entriesByService: Record<string, number> = {};
        let elsewhere = 0;
        const ways: WayInFound[] = [];
        for (const way of walked.found) {
          // Its ways in are the rows: a consumer nothing read publishes to is walked past, and listed by its way in.
          if (ownIds.has(way.node.id) || way.node.type !== 'entry') continue;
          if (!inScope(way.node)) {
            elsewhere += 1;
            continue;
          }
          ways.push(way);
          entriesByService[way.node.repo] = (entriesByService[way.node.repo] ?? 0) + 1;
        }
        // A chain that ends before any way in, where an unread call could reach it: a maybe row, with the gap.
        const maybes = walked.tops.filter((top) => !ownIds.has(top.node.id) && inScope(top.node) && reader.maybeEnd(top.node));
        const byId = (a: WayInFound, b: WayInFound): number => (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0);
        const listed = [...ways.sort(byId), ...maybes.sort(byId)];

        // A change is visible in every service the chain runs into, whether or
        // not an entry point was found above it. Counting only the entry points
        // answered "one entry, in this service" for a change another repository
        // also reaches, which reads as "nothing outside this service".
        const servicesWithoutEntry = Object.keys(reachedByService)
          .filter((repo) => entriesByService[repo] === undefined)
          .sort();

        const { items, total, truncated, nextOffset } = truncate(listed, maxNodes, input.offset);
        // Whether each way in runs (P364) and the crossing it reaches the target through (P367).
        const rows = items.map((way) => {
          const row = reader.annotate(projectDetail(way.node, detail));
          return detail < 1 || way.via === undefined ? row : { ...row, via: viaSaid(way.via, way.node) };
        });
        const targetReach = detail < 1 ? undefined : reader.of(target.id).reach;
        const args = { symbol: target.id, service: input.service, detail: input.detail, maxNodes };
        // The walk's own limit is a cut, said where cuts are said (P94): it
        // used to be a note, which the detail clamp's note overwrote (P132).
        const walkCut = walked.cut
          ? `reachability stopped at the walk limit of ${IMPACT_WALK_NODES} nodes; entries past it are not listed`
          : undefined;
        const cuts = [...(nextOffset === undefined ? [] : [truncated!]), ...(walkCut === undefined ? [] : [walkCut])];
        // No way in, said rather than left as an empty list, with where to look (P94).
        const entriesNone =
          ways.length > 0
            ? undefined
            : elsewhere > 0
              ? `no way in of ${input.service ?? ''} reaches this; ${elsewhere} in other services do`
              : reached > 0
                ? 'nothing in the graph reaches this from a way in; the callers may be behind a gap'
                : 'nothing reaches this';
        const leads =
          entriesNone === undefined
            ? nextFor(items[0]?.node)
            : [
                ...(elsewhere > 0 ? [callOf('impact', { symbol: target.id })] : []),
                // Deeper callers only where something reaches it at all.
                ...(reached > 0 && maybes.length === 0 ? [callOf('who_calls', { symbol: target.id, depth: 8 }, { ...COMMON_DEFAULTS, depth: DEFAULT_CALLER_DEPTH })] : []),
                ...gapLeads(target),
              ];
        return withNext({
          target: { ...projectDetail(target, detail), ...(targetReach === undefined ? {} : { reach: targetReach }) },
          ...(found.alsoAnswers === undefined ? {} : { alsoAnswers: found.alsoAnswers }),
          ...(forClass ? { forMethods: starts.length } : {}),
          entries: rows,
          total,
          ...(cuts.length === 0 ? {} : { truncated: cuts.join('; ') }),
          ...(nextOffset === undefined ? {} : { nextOffset }),
          ...(entriesNone === undefined ? {} : { entriesNone }),
          // How many things reach it at all, so no entry points is telling
          // rather than indistinguishable from nothing reaching it.
          reached,
          entriesByService,
          ...(maybes.length === 0 ? {} : { maybe: maybes.length }),
          reachedByService,
          servicesWithoutEntry,
          channels: [...channels].sort(),
          // The pages about it (P120): what to update beside what to retest.
          ...withDocs(db, ctx.handle.path, target.id),
          ...completeOf([
            pageLeft(total, items.length, input.offset, nextOffset),
            walkCut !== undefined && `walk: stopped at ${IMPACT_WALK_NODES} nodes; ways in past it not listed`,
            maybes.length > 0 &&
              `gaps: ${maybes.length} chain${maybes.length === 1 ? ' stops' : 's stop'} at an unread call before any way in: the maybe row${maybes.length === 1 ? '' : 's'}`,
            entriesNone !== undefined && reached > 0 && elsewhere === 0 && maybes.length === 0 && 'gaps: something reaches it but no way in does; its callers may be behind a gap',
            ...reader.left(),
          ]),
          ...(note === undefined ? {} : { note }),
        }, pagedNext({ tool: 'impact', args, nextOffset }, withoutShown(leads, rows)));
      }),
  );
};
