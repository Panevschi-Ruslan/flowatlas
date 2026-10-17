import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
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

export const registerFlow = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_flow',
    {
      title: 'Trace an entry point',
      description: 'One entry followed across repositories, as a call-order tree with guards.',
      inputSchema: {
        entry: z.string().describe('"POST /orders" or an entry id'),
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
