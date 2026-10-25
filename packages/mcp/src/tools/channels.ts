import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, nextFor, withNext } from '../query/next.js';
import {
  bound,
  commonInput,
  inService,
  nextOutput,
  nodeOutput,
  pagedNext,
  pageInput,
  pageOutput,
  READ_ONLY,
  serviceInput,
  withDb,
  type ToolContext,
} from './common.js';

/** What who_emits and who_consumes answer: the channel, and one page of one end of it. */
const endsOutput = (key: 'producers' | 'consumers') => ({
  channel: nodeOutput,
  [key]: z.array(nodeOutput),
  ...pageOutput,
  note: z.string().optional(),
  next: nextOutput,
});

export const whoEmitsOutput = endsOutput('producers');
export const whoConsumesOutput = endsOutput('consumers');

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
          channel: z.string().describe('name or channel id'),
          service: serviceInput,
          ...commonInput,
          ...pageInput,
        },
        outputSchema: key === 'producers' ? whoEmitsOutput : whoConsumesOutput,
        annotations: READ_ONLY,
      },
      (input) =>
        withDb(ctx.handle, (db) => {
          const { detail, maxNodes, note } = bound(input);
          const id = channelId(input.channel);
          const channel = db.node(id);
          if (channel === undefined) {
            // The nearest names, each a call that takes it (P94): a typo is
            // one step from its channel, not a dead end.
            const near = nearNames(db.nodesByType('channel'), input.channel.trim().replace(/^channel:/, ''), 5);
            return withNext(
              { error: `no channel named ${JSON.stringify(id)}`, suggestions: near.map((node) => projectDetail(node, 0)) },
              near.slice(0, MAX_NEXT).map((node) => `${name}({channel: ${JSON.stringify(node.id)}})`),
            );
          }

          // A publisher points at the channel; the channel points at a handler.
          const edges =
            key === 'producers' ? db.edgesTo(id, ['emits']) : db.edgesFrom(id, ['consumes']);
          const nodes = edges
            .map((edge) => db.node(key === 'producers' ? edge.from : edge.to))
            .filter((node) => node !== undefined)
            .filter(inService(input.service))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

          const { items, total, truncated, nextOffset } = truncate(nodes, maxNodes, input.offset);
          const other = key === 'producers' ? 'who_consumes' : 'who_emits';
          const args = { channel: id, service: input.service, detail: input.detail, maxNodes };
          return withNext(
            {
              channel: projectDetail(channel, detail),
              [key]: items.map((node) => projectDetail(node, detail)),
              total,
              ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
              ...(note === undefined ? {} : { note }),
            },
            pagedNext(
              { tool: name, args, nextOffset },
              [`${other}({channel: ${JSON.stringify(id)}})`, ...nextFor(items[0])].slice(0, 4),
            ),
          );
        }),
    );
  };

  ends(
    'who_emits',
    'Who publishes to a channel',
    'What publishes on a channel, in every repository.',
    'producers',
  );
  ends(
    'who_consumes',
    'Who handles a channel',
    'What handles a channel; empty means nothing does.',
    'consumers',
  );
};
