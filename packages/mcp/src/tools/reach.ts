import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, projectEdge, truncate } from '../query/detail.js';
import { REVERSE_EDGES, walkBack } from '../query/flow.js';
import { truncationMessage, type FlowNode } from '../query/types.js';
import { rankMatches } from './entries.js';
import { nextFor, withNext } from '../query/next.js';
import { loadObservedCounts, markObserved, nodeSeen } from '../query/observed.js';
import { bound, commonInput, inService, serviceInput, withDb, type ToolContext } from './common.js';

/** Accepts an id, or a name close enough to identify one thing. */
const findTarget = (db: GraphDb, symbol: string): GraphNode | GraphNode[] => {
  const exact = db.node(symbol.trim());
  if (exact !== undefined) return exact;
  const ranked = rankMatches(db.search(symbol, { limit: 200 }), symbol);
  if (ranked.length === 0) return [];
  const best = ranked[0]!;
  const tied = ranked.filter((match) => match.score === best.score);
  return tied.length === 1 ? best.node : tied.slice(0, 8).map((match) => match.node);
};

/**
 * Walks inward from a node and builds the tree of what reaches it.
 *
 * The same shape as a forward walk, read the other way round: each child is
 * something that calls its parent. Breadth first, so the nearest callers are
 * the ones that survive a cut.
 */
const callersOf = (
  db: GraphDb,
  id: string,
  depth: number,
  maxNodes: number,
  detail: 0 | 1 | 2 | 3,
): { callers: FlowNode[]; truncated?: string } => {
  const roots: FlowNode[] = [];
  const queue: Array<{ id: string; level: number; into: FlowNode[]; path: ReadonlySet<string> }> = [
    { id, level: 0, into: roots, path: new Set([id]) },
  ];
  let used = 0;
  let overflow = 0;

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.level >= depth) continue;

    for (const edge of db.edgesTo(item.id, REVERSE_EDGES)) {
      if (item.path.has(edge.from)) continue;
      if (used >= maxNodes) {
        overflow += 1;
        continue;
      }
      const source = db.node(edge.from);
      if (source === undefined) continue;

      const flow: FlowNode = {
        node: projectDetail(source, detail),
        edge: projectEdge(edge, detail),
        children: [],
      };
      used += 1;
      item.into.push(flow);
      queue.push({
        id: edge.from,
        level: item.level + 1,
        into: flow.children,
        path: new Set([...item.path, edge.from]),
      });
    }
  }

  return {
    callers: roots,
    ...(overflow > 0 ? { truncated: truncationMessage(overflow, true) } : {}),
  };
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

export const registerReach = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'who_calls',
    {
      title: 'Who calls this',
      description:
        'Everything that reaches a symbol, following calls backward across repositories: direct callers, the routes that handle them, and requests from other services.',
      inputSchema: {
        symbol: z.string().describe('a node id, or a name close enough to identify one'),
        depth: z.number().int().positive().max(16).default(3).describe('how many hops back'),
        service: serviceInput,
        ...commonInput,
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const found = findTarget(db, input.symbol);
        if (Array.isArray(found)) {
          return found.length === 0
            ? { error: `no symbol matches ${JSON.stringify(input.symbol)}` }
            : withNext({ candidates: found.map((node) => projectDetail(node, detail)) }, nextFor(found[0]));
        }

        const walked = callersOf(db, found.id, input.depth, maxNodes, detail);
        const callers = keepService(db, walked.callers, input.service);
        const firstEntry = findFirst(callers, (item) => item.node.type === 'entry');
        const counts = loadObservedCounts(ctx.handle.path);
        if (counts !== undefined) markObserved(counts, found.id, callers, 'backward');
        const seen = counts === undefined ? undefined : nodeSeen(counts, found.id);
        return withNext(
          {
            target: { ...projectDetail(found, detail), ...(seen === undefined ? {} : { observed: seen }) },
            callers,
            ...(walked.truncated === undefined ? {} : { truncated: walked.truncated }),
            ...(note === undefined ? {} : { note }),
          },
          nextFor(firstEntry?.node, found),
        );
      }),
  );

  server.registerTool(
    'impact',
    {
      title: 'Blast radius',
      description:
        'Every entry point that can reach a symbol, which services they belong to, and which services the chain runs into without an entry point above them. What would have to be retested if this changed.',
      inputSchema: {
        symbol: z.string().describe('a node id, or a name close enough to identify one'),
        service: serviceInput,
        ...commonInput,
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const found = findTarget(db, input.symbol);
        if (Array.isArray(found)) {
          return found.length === 0
            ? { error: `no symbol matches ${JSON.stringify(input.symbol)}` }
            : withNext({ candidates: found.map((node) => projectDetail(node, detail)) }, nextFor(found[0]));
        }

        // Twelve hops back, and one more per step of every workflow the walk climbs through.
        const reach = walkBack(12, (maxDepth) => db.reverseReach(found.id, { edgeTypes: REVERSE_EDGES, maxDepth, maxNodes: 4000 }));
        const entries: GraphNode[] = [];
        const channels = new Set<string>();
        const entriesByService: Record<string, number> = {};
        const reachedByService: Record<string, number> = {};
        let reached = 0;

        for (const row of reach.rows) {
          if (row.id === found.id) continue;
          reached += 1;
          const node = db.node(row.id);
          if (node !== undefined) {
            reachedByService[node.repo] = (reachedByService[node.repo] ?? 0) + 1;
          }
          if (row.type === 'channel') channels.add(row.id);
          if (row.type !== 'entry' || node === undefined || !inService(input.service)(node)) continue;
          entries.push(node);
          entriesByService[node.repo] = (entriesByService[node.repo] ?? 0) + 1;
        }

        // A change is visible in every service the chain runs into, whether or
        // not an entry point was found above it. Counting only the entry points
        // answered "one entry, in this service" for a change another repository
        // also reaches, which reads as "nothing outside this service".
        const servicesWithoutEntry = Object.keys(reachedByService)
          .filter((repo) => entriesByService[repo] === undefined)
          .sort();

        entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const { items, truncated } = truncate(entries, maxNodes);
        return withNext({
          target: projectDetail(found, detail),
          entries: items.map((entry) => projectDetail(entry, detail)),
          // How many things reach it at all, so no entry points is telling
          // rather than indistinguishable from nothing reaching it.
          reached,
          entriesByService,
          reachedByService,
          servicesWithoutEntry,
          channels: [...channels].sort(),
          ...(truncated === undefined ? {} : { truncated }),
          ...(reach.truncated ? { note: 'reachability stopped at the walk limit' } : {}),
          ...(note === undefined ? {} : { note }),
        }, nextFor(items[0]));
      }),
  );
};
