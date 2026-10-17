import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { nextFor, withNext } from '../query/next.js';
import { START_LIMITS, summariseProject } from '../query/start.js';
import { serviceInput, withDb, type ToolContext } from './common.js';

/** The services at each end of every channel, read once. */
const channelEnds = (db: GraphDb): Map<string, { producers: string[]; consumers: string[] }> => {
  const ends = new Map<string, { producers: string[]; consumers: string[] }>();
  const serviceOf = (id: string): string => db.node(id)?.repo ?? '';
  for (const channel of db.nodesByType('channel')) {
    ends.set(channel.id, {
      producers: db.edgesTo(channel.id, ['emits']).map((edge) => serviceOf(edge.from)),
      consumers: db.edgesFrom(channel.id, ['consumes']).map((edge) => serviceOf(edge.to)),
    });
  }
  return ends;
};

export const registerStart = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'start_here',
    {
      title: 'Start here',
      description:
        'The first question of a session: how many entry points and nodes each service has, the unresolved rows counted by kind (gaps the reading could not follow, notes on how a join was made, findings about the code), the most common gaps, channels with one end missing, and a few entry ids to pass to get_flow. Bounded.',
      inputSchema: {
        service: serviceInput,
        perService: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(START_LIMITS.perService)
          .describe('entry ids to start from, per service'),
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const summary = summariseProject(
          {
            nodes: db.allNodes(),
            channelEnds: channelEnds(db),
            // A finding's symbol is often source text rather than a node; only an id
            // another tool would take is handed on.
            unresolved: db.allUnresolved().map((row) =>
              row.node === null || db.node(row.node) !== undefined ? row : { ...row, node: null },
            ),
            ...(input.service === undefined ? {} : { service: input.service }),
          },
          { ...START_LIMITS, perService: input.perService },
        );
        const lonely = summary.channels.noConsumers[0] ?? summary.channels.noProducers[0];
        return withNext(
          summary,
          nextFor(
            summary.startFrom[0],
            lonely === undefined ? undefined : { id: lonely, type: 'channel' },
          ).slice(0, 3),
        );
      }),
  );
};
