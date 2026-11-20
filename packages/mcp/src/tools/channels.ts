import { isMessageTypeNode, makeMessageTypeId, type GraphNode } from '@flowatlas/core';
import { messageTypeFacts, messageTypesOn, unselectedSaid, type GraphDb, type MessageTypeFacts } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveChannelRef } from '../query/channel-ref.js';
import { projectDetail, truncate } from '../query/detail.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, nextFor, withNext } from '../query/next.js';
import type { CompactNode } from '../query/types.js';
import {
  bound,
  callOf,
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

/** A handler that selects one type, with where the choice was made (P358). */
const selectorOutput = nodeOutput.extend({
  /** The consumer whose handler chose the type, where it is not this one. */
  selectedIn: z.string().optional(),
  /** How the choice is written: switch, if, guard, map or decorator. */
  via: z.string().optional(),
  /** Why it never runs, where nothing builds its class. */
  unreached: z.string().optional(),
});

/** What who_emits and who_consumes answer: the channel, and one page of one end of it. */
const endsOutput = (key: 'producers' | 'consumers') => ({
  channel: nodeOutput,
  [key]: z.array(key === 'consumers' ? selectorOutput : nodeOutput),
  ...pageOutput,
  /** The channel id answered for, when the name asked was written another way (`tenant:<id>:events`, P360). */
  channelUsed: z.string().optional(),
  /** The type of message asked about, where one was (P358). */
  type: z.string().optional(),
  /** The types of message read on the channel, where it carries several. */
  types: z.array(z.string()).optional(),
  /** "No code selects this type", with who receives the channel instead and how sure that is. */
  unselected: z.string().optional(),
  sureness: z.string().optional(),
  /** Publishes on the channel whose type was not read: any may send the type asked about. */
  maybe: z.array(nodeOutput).optional(),
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

/** How many channels a name written with placeholders lists when it fits several. */
const MAX_FITTING = 8;

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The values of the types read on a channel, in order. */
const typeValues = (db: GraphDb, channel: string): string[] =>
  messageTypesOn(db, channel).map((node) => String(node.meta?.['messageType'] ?? node.label));

/** A selector as listed: the consumer, and where and how the choice was made. */
const selectorRow = (db: GraphDb, facts: MessageTypeFacts, consumer: GraphNode, detail: Parameters<typeof projectDetail>[1]): CompactNode & Record<string, unknown> => {
  const found = facts.selectors.find((selector) => selector.consumer.id === consumer.id);
  const via = found?.edge.meta?.['via'];
  const selectedIn = found?.selectedBy === undefined ? undefined : (db.node(found.selectedBy)?.label ?? found.selectedBy);
  return {
    ...projectDetail(consumer, detail),
    ...(selectedIn === undefined ? {} : { selectedIn }),
    ...(typeof via === 'string' ? { via } : {}),
    ...(found?.unreached === undefined ? {} : { unreached: found.unreached }),
  };
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
          type: z.string().optional().describe('a message type on it'),
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
          const found = resolveChannelRef(db, input.channel);
          if (found === undefined || 'candidates' in found) {
            // Written with placeholders and fitting several: each, as the call that takes it.
            const fitting = found?.candidates.slice(0, MAX_FITTING);
            // Otherwise the nearest names, each a call that takes it (P94): a
            // typo is one step from its channel, not a dead end.
            const near = fitting ?? nearNames(db.nodesByType('channel').filter((node) => !isMessageTypeNode(node)), input.channel.trim().replace(/^channel:/, ''), 5);
            return withNext(
              {
                error:
                  found === undefined
                    ? `no channel named ${JSON.stringify(channelId(input.channel))}`
                    : `${JSON.stringify(input.channel.trim())} fits ${found.candidates.length} channels; ask for one of them`,
                suggestions: near.map((node) => projectDetail(node, 0)),
              },
              near.slice(0, MAX_NEXT).map((node) => `${name}({channel: ${JSON.stringify(node.id)}})`),
            );
          }
          const channel = found.node;
          const id = channel.id;
          const other = key === 'producers' ? 'who_consumes' : 'who_emits';
          const used = found.channelUsed === undefined ? {} : { channelUsed: found.channelUsed };

          // A type of message asked about (P358): by `type`, or by its own id.
          const parent = isMessageTypeNode(channel) ? db.node(String(channel.meta?.['channel'] ?? '')) ?? channel : channel;
          const wanted = input.type?.trim() ?? (isMessageTypeNode(channel) ? String(channel.meta?.['messageType'] ?? '') : undefined);
          if (wanted !== undefined && wanted !== '') {
            const type = db.node(makeMessageTypeId(parent.id, wanted));
            const values = typeValues(db, parent.id);
            if (type === undefined) {
              const unread = db
                .edgesTo(parent.id, ['emits'])
                .flatMap((edge) => db.node(edge.from) ?? [])
                .filter((producer) => typeof producer.meta?.['messageTypeUnread'] === 'string');
              const near = nearNames(values.map((value): GraphNode => ({ id: value, label: value, type: 'channel', repo: '' })), wanted, 3);
              return withNext(
                {
                  channel: projectDetail(parent, detail),
                  [key]: [],
                  total: 0,
                  ...used,
                  type: wanted,
                  ...(values.length === 0 ? {} : { types: values }),
                  ...(key === 'consumers' ? { unselected: `no code selects ${wanted} on ${parent.label}, and nothing read publishes it`, sureness: unread.length === 0 ? 'sure' : 'unsure' } : {}),
                  note:
                    `no type ${JSON.stringify(wanted)} is read on ${parent.label}` +
                    (unread.length === 0 ? '' : `; ${unread.length} publish${unread.length === 1 ? '' : 'es'} on it send${unread.length === 1 ? 's' : ''} a type not read, which may be it`),
                  ...(unread.length === 0 ? {} : { maybe: unread.slice(0, 3).map((producer) => projectDetail(producer, detail)) }),
                },
                [
                  ...near.map((value) => callOf(name, { channel: parent.id, type: value.id })),
                  callOf(name, { channel: parent.id }),
                ].slice(0, MAX_NEXT),
              );
            }
            const facts = messageTypeFacts(db, type);
            const nodes = (key === 'producers' ? [...facts.producers] : facts.selectors.map((selector) => selector.consumer))
              .filter(inService(input.service))
              .sort(byId);
            const { items, total, truncated, nextOffset } = truncate(nodes, maxNodes, input.offset);
            const said = key === 'consumers' ? unselectedSaid(facts) : undefined;
            const maybe = key === 'producers' && facts.producers.length === 0 ? facts.unreadProducers : [];
            const args = { channel: parent.id, type: wanted, service: input.service, detail: input.detail, maxNodes };
            return withNext(
              {
                channel: projectDetail(parent, detail),
                [key]: items.map((node) => (key === 'consumers' ? selectorRow(db, facts, node, detail) : projectDetail(node, detail))),
                total,
                ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
                ...used,
                type: wanted,
                ...(said === undefined ? {} : { unselected: said.said, sureness: said.sureness }),
                ...(key === 'producers' && facts.producers.length === 0
                  ? {
                      note:
                        `nothing read publishes ${wanted} on ${parent.label}` +
                        (maybe.length === 0 ? '' : `; ${maybe.length} publish${maybe.length === 1 ? '' : 'es'} on it send${maybe.length === 1 ? 's' : ''} a type not read, which may be it`),
                    }
                  : note === undefined
                    ? {}
                    : { note }),
                ...(maybe.length === 0 ? {} : { maybe: maybe.slice(0, 3).map((producer) => projectDetail(producer, detail)) }),
              },
              pagedNext(
                { tool: name, args, nextOffset },
                [
                  callOf(other, { channel: parent.id, type: wanted }),
                  ...(said === undefined ? [] : [callOf('who_consumes', { channel: parent.id })]),
                  ...nextFor(items[0]),
                ].slice(0, 4),
              ),
            );
          }

          // A publisher points at the channel; the channel points at a handler.
          const edges =
            key === 'producers' ? db.edgesTo(id, ['emits']) : db.edgesFrom(id, ['consumes']);
          const nodes = edges
            .map((edge) => db.node(key === 'producers' ? edge.from : edge.to))
            .filter((node) => node !== undefined)
            .filter(inService(input.service))
            .sort(byId);

          const { items, total, truncated, nextOffset } = truncate(nodes, maxNodes, input.offset);
          const args = { channel: id, service: input.service, detail: input.detail, maxNodes };
          // The types it carries, each a question of its own (P358).
          const values = typeValues(db, id);
          return withNext(
            {
              channel: projectDetail(channel, detail),
              [key]: items.map((node) => projectDetail(node, detail)),
              total,
              ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
              ...used,
              ...(values.length === 0 ? {} : { types: values }),
              ...(note === undefined ? {} : { note }),
            },
            pagedNext(
              { tool: name, args, nextOffset },
              [
                ...(values[0] === undefined ? [] : [callOf(name, { channel: id, type: values[0] })]),
                `${other}({channel: ${JSON.stringify(id)}})`,
                ...nextFor(items[0]),
              ].slice(0, 4),
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
