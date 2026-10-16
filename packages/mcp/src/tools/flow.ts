import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { buildFlowTree } from '../query/flow.js';
import { loadObservedCounts, markObserved, nodeSeen } from '../query/observed.js';
import { rankMatches } from './entries.js';
import { withNext } from '../query/next.js';
import { bound, commonInput, withDb, type ToolContext } from './common.js';

export const registerFlow = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_flow',
    {
      title: 'Trace an entry point',
      description:
        'Follow one entry point through every repository it reaches: handlers, calls, queries, channels and the routes it calls in other services. Returns a nested tree in call order, with the guard chain on each entry.',
      inputSchema: {
        entry: z
          .string()
          .describe('an entry: "POST /orders", "bot:order_confirm", or the id any list tool returns'),
        depth: z
          .number()
          .int()
          .positive()
          .max(32)
          .optional()
          .describe('how many hops to follow; by default 8, and one more per step of a workflow'),
        ...commonInput,
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const ref = resolveEntryRef(db, input.entry);

        if (!isResolved(ref)) {
          if (ref.candidates.length > 0) {
            return withNext(
              { candidates: ref.candidates.map((node) => projectDetail(node, detail)) },
              ref.candidates.slice(0, 2).map((node) => `get_flow({entry: ${JSON.stringify(node.id)}})`),
            );
          }
          const suggestions = rankMatches(db.nodesByType('entry'), input.entry)
            .slice(0, 5)
            .map((match) => projectDetail(match.node, detail));
          return { error: `no entry matches ${JSON.stringify(input.entry)}`, suggestions };
        }

        const flow = buildFlowTree(db, ref.id, {
          ...(input.depth === undefined ? {} : { depth: input.depth }),
          maxNodes,
          detail,
        });
        const counts = loadObservedCounts(ctx.handle.path);
        if (counts !== undefined) {
          const seen = nodeSeen(counts, ref.id);
          if (seen !== undefined) flow.root.observed = seen;
          markObserved(counts, ref.id, flow.root.children, 'forward');
        }
        const id = JSON.stringify(ref.id);
        return withNext(
          {
            root: flow.root,
            unresolvedOnPath: flow.unresolvedOnPath,
            ...(flow.truncated === undefined ? {} : { truncated: flow.truncated }),
            ...(note === undefined ? {} : { note }),
          },
          [
            `describe_for_prompt({id: ${id}})`,
            `impact({symbol: ${id}})`,
            ...(flow.root.children[0] === undefined ? [] : [`get_source({symbol: ${JSON.stringify(flow.root.children[0].node.id)}})`]),
          ],
        );
      }),
  );
};
