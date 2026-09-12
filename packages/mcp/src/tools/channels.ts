import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { bound, commonInput, withDb, type ToolContext } from './common.js';

/** `order.created` and `channel:order.created` are the same thing. */
const channelId = (ref: string): string => {
  const trimmed = ref.trim();
  return trimmed.startsWith('channel:') ? trimmed : `channel:${trimmed}`;
};

export const registerChannels = (server: McpServer, ctx: ToolContext): void => {
  const ends = (
    name: 'who_emits' | 'who_consumes',
    title: string,
    description: string,
    key: 'producers' | 'consumers',
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          channel: z.string().describe('a channel name, with or without the "channel:" prefix'),
          ...commonInput,
        },
      },
      (input) =>
        withDb(ctx.handle, (db) => {
          const { detail, maxNodes, note } = bound(input);
          const id = channelId(input.channel);
          const channel = db.node(id);
          if (channel === undefined) return { error: `no channel named ${JSON.stringify(id)}` };

          // A publisher points at the channel; the channel points at a handler.
          const edges =
            key === 'producers' ? db.edgesTo(id, ['emits']) : db.edgesFrom(id, ['consumes']);
          const nodes = edges
            .map((edge) => db.node(key === 'producers' ? edge.from : edge.to))
            .filter((node) => node !== undefined)
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

          const { items, truncated } = truncate(nodes, maxNodes);
          return {
            channel: projectDetail(channel, detail),
            [key]: items.map((node) => projectDetail(node, detail)),
            ...(truncated === undefined ? {} : { truncated }),
            ...(note === undefined ? {} : { note }),
          };
        }),
    );
  };

  ends(
    'who_emits',
    'Who publishes to a channel',
    'Everything that publishes a message on a channel, across every repository.',
    'producers',
  );
  ends(
    'who_consumes',
    'Who handles a channel',
    'Everything that handles messages from a channel, across every repository. An empty list means nothing handles it.',
    'consumers',
  );
};
