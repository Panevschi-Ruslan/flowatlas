import type { DetailLevel, GraphNode } from '@flowatlas/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveEntryRef, resolveSymbol } from '../query/entry-ref.js';
import { findPath, type PathResult } from '../query/path.js';
import { withDocs } from '../query/docs.js';
import { buildFlowTree, type FlowResult } from '../query/flow.js';
import { failuresSeenRef, markFailsSeen } from '../query/fails.js';
import { failuresSeen, figuresOf, loadObservedCounts, markObserved, nodeAmbiguous, nodeRow, sampledIn } from '../query/observed.js';
import type { FlowNode } from '../query/types.js';
import { nearNames } from './entries.js';
import { MAX_NEXT, withNext, withTraceFor } from '../query/next.js';
import { slimTree } from '../query/wire.js';
import { bound, callOf, commonInput, READ_ONLY, withDb, type ToolContext } from './common.js';
import { trafficDiffers } from './contract.js';

/**
 * `next` with `check_contract({edge: entry})` second (P113), when traffic
 * into the entry carried bodies that differ from what its code declares.
 */
const withDrift = (next: readonly string[], entry: string, differs: boolean): string[] =>
  !differs ? [...next] : [...next.slice(0, 1), callOf('check_contract', { edge: entry }), ...next.slice(1)].slice(0, MAX_NEXT);
import { rulesReportOf, violatedHops } from './rules.js';

/** Marks each step whose hop in a violation of an architecture rule runs along (P114). */
const markViolations = (root: FlowNode, hops: ReadonlyMap<string, string[]>): void => {
  if (hops.size === 0) return;
  const visit = (row: FlowNode): void => {
    for (const child of row.children) {
      const rules = hops.get(`${row.node.id}|${child.node.id}`) ?? hops.get(`${child.node.id}|${row.node.id}`);
      if (rules !== undefined && child.node.ref !== true) child.violates = rules;
      visit(child);
    }
  };
  visit(root);
};

/**
 * What `get_flow` shows when nobody says (P92 D4): a tree, not a list, so fewer
 * rows than a list tool's 150, and about as many characters as an assistant
 * reads in one go. Whichever comes first stops the walk.
 */
export const FLOW_DEFAULTS = { maxNodes: 60, maxChars: 12000 } as const;

/** The first row reached across an HTTP call, breadth first, with the row it hangs under. */
const firstHttpCrossing = (root: FlowNode): { from: string; to: string } | undefined => {
  const queue: Array<{ row: FlowNode; parent: string }> = root.children.map((row) => ({ row, parent: root.node.id }));
  while (queue.length > 0) {
    const { row, parent } = queue.shift()!;
    if (row.edge?.type === 'http_calls' && row.node.ref !== true) return { from: parent, to: row.node.id };
    queue.push(...row.children.map((child) => ({ row: child, parent: row.node.id })));
  }
  return undefined;
};

/**
 * The calls worth making next (P92): the prompt, whether the first HTTP
 * crossing still agrees on its shapes, the first crossing the walk did not
 * follow, the blast radius, and the source of the first step.
 */
const flowNext = (id: string, flow: FlowResult): string[] => {
  const http = firstHttpCrossing(flow.root);
  const left = flow.crossingsLeft?.[0];
  const first = flow.root.children[0];
  return [
    `describe_for_prompt({id: ${JSON.stringify(id)}})`,
    ...(http === undefined ? [] : [callOf('check_contract', http)]),
    ...(left === undefined ? [] : [callOf('get_flow', { entry: left.to })]),
    `impact({symbol: ${JSON.stringify(id)}})`,
    ...(first === undefined ? [] : [`get_source({symbol: ${JSON.stringify(first.node.id)}})`]),
  ].slice(0, MAX_NEXT);
};

/** The deepest a path search looks when it widens by itself: the last of `PATH_DEPTHS`. */
const WIDEST_PATH = 24;

/**
 * `get_flow` with `to` (P229): the flow cut down to the shortest ways that
 * reach `to`, from the entry or from any node, in the tree `get_flow` answers
 * with. No path is said with how far was looked and how much was searched, and
 * with the other way round when that holds, so the next call is the right one.
 */
const pathAnswer = (fromId: string, toId: string, path: PathResult, depth: number | undefined) => {
  const asked = depth === undefined ? {} : { depth };
  const next = path.found
    ? [callOf('describe_for_prompt', { id: toId }), callOf('impact', { symbol: toId }), callOf('get_flow', { entry: fromId })]
    : path.reverse !== undefined
      ? [callOf('get_flow', { entry: toId, to: fromId, ...asked })]
      : path.depth < WIDEST_PATH
        ? [callOf('get_flow', { entry: fromId, to: toId, depth: WIDEST_PATH })]
        : [callOf('get_flow', { entry: fromId }), callOf('impact', { symbol: toId })];
  return withNext(
    {
      root: slimTree(path.root),
      to: toId,
      pathsFound: path.paths,
      length: path.length,
      searched: path.searched,
      depth: path.depth,
      unresolvedOnPath: path.unresolvedOnPath,
      ...(path.left === 0 ? {} : { truncated: `${path.left} more nodes on a shortest path (raise maxNodes)`, stoppedBy: ['maxNodes'] }),
      ...(path.found ? {} : { none: `no path within ${path.depth} steps; searched ${path.searched} nodes` }),
      ...(path.reverse === undefined ? {} : { reverse: { ...path.reverse, note: `${toId} reaches ${fromId} instead` } }),
    },
    next,
  );
};

/** One end of a path that named several nodes or none: the candidates, each as the call that takes it. */
const endUnresolved = (
  end: { candidates: GraphNode[] },
  key: 'entry' | 'to',
  said: string,
  keep: Record<string, string>,
  detail: DetailLevel,
) =>
  end.candidates.length > 0
    ? withNext(
        { [key]: said, candidates: end.candidates.map((node) => projectDetail(node, detail)) },
        end.candidates.slice(0, MAX_NEXT).map((node) => callOf('get_flow', { ...keep, [key]: node.id })),
      )
    : { error: `nothing matches ${JSON.stringify(said)}`, [key]: said };

export const registerFlow = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_flow',
    {
      title: 'Trace an entry point',
      description: 'One entry followed across repositories, as a call-order tree with guards; with `to`, the shortest ways there.',
      inputSchema: {
        entry: z.string().describe('"POST /orders" or an entry id'),
        to: z.string().optional(),
        depth: z.number().int().min(1).max(32).optional().describe('hops; default 8, +1 per workflow step'),
        detail: commonInput.detail,
        maxNodes: z.number().int().min(1).max(2000).default(FLOW_DEFAULTS.maxNodes),
        maxChars: z.number().int().min(1000).max(200000).default(FLOW_DEFAULTS.maxChars),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        if (input.to !== undefined) {
          // A path may start anywhere, so both ends resolve as any tool resolves a name.
          const from = resolveSymbol(db, input.entry);
          const to = resolveSymbol(db, input.to);
          if (!isResolved(from)) return endUnresolved(from, 'entry', input.entry, { to: input.to }, detail);
          if (!isResolved(to)) return endUnresolved(to, 'to', input.to, { entry: input.entry }, detail);
          const path = findPath(db, from.id, to.id, {
            ...(input.depth === undefined ? {} : { depth: input.depth }),
            maxNodes,
            detail,
          });
          return { ...pathAnswer(from.id, to.id, path, input.depth), ...(note === undefined ? {} : { note }) };
        }
        const ref = resolveEntryRef(db, input.entry);

        if (!isResolved(ref)) {
          if (ref.candidates.length > 0) {
            return withNext(
              { candidates: ref.candidates.map((node) => projectDetail(node, detail)) },
              ref.candidates.slice(0, MAX_NEXT).map((node) => `get_flow({entry: ${JSON.stringify(node.id)}})`),
            );
          }
          const near = nearNames(db.nodesByType('entry'), input.entry, 5);
          return withNext(
            { error: `no entry matches ${JSON.stringify(input.entry)}`, suggestions: near.map((node) => projectDetail(node, detail)) },
            near.slice(0, MAX_NEXT).map((node) => `get_flow({entry: ${JSON.stringify(node.id)}})`),
          );
        }

        const flow = buildFlowTree(db, ref.id, {
          ...(input.depth === undefined ? {} : { depth: input.depth }),
          maxNodes,
          maxChars: input.maxChars,
          detail,
        });
        markViolations(flow.root, violatedHops(rulesReportOf(db, ctx)));
        const counts = loadObservedCounts(ctx.handle.path);
        if (counts !== undefined) {
          const seen = nodeRow(counts, ref.id);
          if (seen !== undefined) Object.assign(flow.root, { observed: seen.hits, ...figuresOf(seen) });
          const unsure = nodeAmbiguous(counts, ref.id);
          if (unsure !== undefined) flow.root.seenAmbiguous = unsure;
          markObserved(counts, ref.id, flow.root.children, 'forward');
          // What the way in answered against what it declares (P106).
          const compared = failuresSeen(counts, ref.node);
          if (compared !== undefined) {
            markFailsSeen(flow.root.fails, { count: compared.hits, ...(seen?.statuses === undefined ? {} : { statuses: seen.statuses }) });
            flow.root.failures = failuresSeenRef(compared);
          }
        }
        return withNext(
          {
            root: slimTree(flow.root),
            // The less specific routes that answer the same request (P94 D2).
            ...(ref.alsoAnswers === undefined ? {} : { alsoAnswers: ref.alsoAnswers }),
            unresolvedOnPath: flow.unresolvedOnPath,
            ...(flow.truncated === undefined ? {} : { truncated: flow.truncated, stoppedBy: flow.stoppedBy }),
            ...(flow.crossingsLeft === undefined ? {} : { crossingsLeft: flow.crossingsLeft }),
            // The pages that describe this flow (P120): a change here is one they must follow.
            ...withDocs(db, ctx.handle.path, ref.id),
            ...(note === undefined ? {} : { note }),
          },
          withDrift(
            withTraceFor(flowNext(ref.id, flow), ref.node, sampledIn(ctx.handle.path)),
            ref.id,
            ref.node?.type === 'entry' && trafficDiffers(ctx, ref.id),
          ),
        );
      }),
  );
};
