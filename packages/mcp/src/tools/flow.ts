import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { buildFlowTree } from '../query/flow.js';
import { rankMatches } from './entries.js';
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
          .describe('an entry: "POST /orders", "bot:order_confirm", or a full entry id'),
        depth: z.number().int().positive().max(32).default(8).describe('how many hops to follow'),
        ...commonInput,
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const ref = resolveEntryRef(db, input.entry);

        if (!isResolved(ref)) {
          if (ref.candidates.length > 0) {
            return { candidates: ref.candidates.map((node) => projectDetail(node, detail)) };
          }
          const suggestions = rankMatches(db.nodesByType('entry'), input.entry)
            .slice(0, 5)
            .map((match) => projectDetail(match.node, detail));
          return { error: `no entry matches ${JSON.stringify(input.entry)}`, suggestions };
        }

        const flow = buildFlowTree(db, ref.id, { depth: input.depth, maxNodes, detail });
        return {
          root: flow.root,
          unresolvedOnPath: flow.unresolvedOnPath,
          ...(flow.truncated === undefined ? {} : { truncated: flow.truncated }),
          ...(note === undefined ? {} : { note }),
        };
      }),
  );
};
