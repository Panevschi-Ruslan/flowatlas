import { isMessageTypeNode, makeMessageTypeId, type GraphNode } from '@flowatlas/core';
import { messageTypeFacts, messageTypesOn, unselectedSaid, type GraphDb, type MessageTypeFacts } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveChannelRef } from '../query/channel-ref.js';
import { projectDetail, truncate } from '../query/detail.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, nextFor, withNext, withoutShown } from '../query/next.js';
import { reachReader, type ReachReader } from '../query/ways-in.js';
import { consumerReading, fieldNames, producerSends, readsField, topField } from '../query/fields.js';
import type { CompactNode } from '../query/types.js';
import {
  bound,
  callOf,
  commonInput,
  completeOf,
  inService,
  nextOutput,
  completeOutput,
  nodeOutput,
  pagedNext,
  pageInput,
  pageLeft,
  pageOutput,
  reachedNodeOutput,
  READ_ONLY,
  serviceInput,
  withDb,
  type ToolContext,
} from './common.js';

/** A handler that selects one type, with where the choice was made (P358). */
const selectorOutput = reachedNodeOutput.extend({
  /** The consumer whose handler chose the type, where it is not this one. */
  selectedIn: z.string().optional(),
  /** How the choice is written: switch, if, guard, map, decorator, or filter (an operator in front of a subscription). */
  via: z.string().optional(),
  /** Why it never runs, where nothing builds its class. */
  unreached: z.string().optional(),
  /** Where it reads the field asked about (P368): the function and the line. */
  readIn: z.array(z.object({ id: z.string(), line: z.number() })).optional(),
  /** The fields of the message it reads, at detail 2 (P368). */
  reads: z.array(z.string()).optional(),
});

/** A publish, with the fields it sends at detail 2 (P368). */
const producerOutput = reachedNodeOutput.extend({ sends: z.array(z.string()).optional() });

/** What who_emits and who_consumes answer: the channel, and one page of one end of it. */
const endsOutput = (key: 'producers' | 'consumers') => ({
  channel: nodeOutput,
  [key]: z.array(key === 'consumers' ? selectorOutput : producerOutput),
  ...pageOutput,
  ...completeOutput,
  /** The channel id answered for, when the name asked was written another way (`tenant:<id>:events`, P360). */
  channelUsed: z.string().optional(),
  /** The type of message asked about, where one was (P358). */
  type: z.string().optional(),
  /** The field asked about, where one was (P368): only the code that reads or sends it is listed. */
  field: z.string().optional(),
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
const selectorRow = (
  db: GraphDb,
  facts: MessageTypeFacts,
  consumer: GraphNode,
  detail: Parameters<typeof projectDetail>[1],
  reader: ReachReader,
): CompactNode & { selectedIn?: string; via?: string; unreached?: string } => {
  const found = facts.selectors.find((selector) => selector.consumer.id === consumer.id);
  const via = found?.edge.meta?.['via'];
  const selectedIn = found?.selectedBy === undefined ? undefined : (db.node(found.selectedBy)?.label ?? found.selectedBy);
  return reader.annotate({
    ...projectDetail(consumer, detail),
    ...(selectedIn === undefined ? {} : { selectedIn }),
    ...(typeof via === 'string' ? { via } : {}),
    ...(found?.unreached === undefined ? {} : { unreached: found.unreached }),
  });
};

/** Publishes whose type was not read, said in `left`: any of them may send the type asked about. */
const unreadSaid = (count: number, channel: string, type: string): string | undefined =>
  count === 0 ? undefined : `unread: ${count} publish${count === 1 ? '' : 'es'} on ${channel} send${count === 1 ? 's' : ''} a type not read; any may be ${type}`;


/**
 * The fields each end reads or sends (P368). With `field`, only the ends that
 * read it (a consumer, each with where) or send it (a publish) are kept, and
 * an end the reading could not settle is said in `left`; without it, at
 * detail 2, each row says the fields it reads or sends.
 */
interface FieldsOfEnds {
  kept: GraphNode[];
  extra: Map<string, Record<string, unknown>>;
  left: string[];
}

const fieldsOfEnds = (
  db: GraphDb,
  key: 'producers' | 'consumers',
  nodes: readonly GraphNode[],
  channel: string,
  type: string | undefined,
  field: string | undefined,
  detail: number,
): FieldsOfEnds => {
  const extra = new Map<string, Record<string, unknown>>();
  if (field === undefined && detail < 2) return { kept: [...nodes], extra, left: [] };
  const kept: GraphNode[] = [];
  const left: string[] = [];
  for (const node of nodes) {
    if (key === 'consumers') {
      const reading = consumerReading(db, node, type);
      if (field === undefined) {
        kept.push(node);
        if (reading.known) extra.set(node.id, { reads: fieldNames(reading) });
        continue;
      }
      if (!reading.known) left.push(`unread: ${node.label} was not read for the fields it reads`);
      for (const use of reading.unread) left.push(`unsure: ${node.label}: ${use.why}, line ${use.line}`);
      const sites = reading.reads.filter((row) => readsField(row.field, field));
      if (sites.length === 0) continue;
      kept.push(node);
      extra.set(node.id, { readIn: sites.map((row) => ({ id: row.id, line: row.line })) });
      continue;
    }
    const sends = producerSends(db, node, channel, type);
    if (field === undefined) {
      kept.push(node);
      if (sends !== undefined) extra.set(node.id, { sends });
      continue;
    }
    if (sends === undefined) left.push(`unsure: ${node.id} sends a shape not read`);
    else if (sends.includes(topField(field))) kept.push(node);
  }
  return { kept, extra, left };
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
          field: z.string().optional(),
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
          // Whether each row runs and where it is reached from (P364).
          const reader = reachReader(db, ctx.handle, detail);
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
                  ...completeOf([unreadSaid(unread.length, parent.label, wanted)]),
                },
                [
                  ...near.map((value) => callOf(name, { channel: parent.id, type: value.id })),
                  callOf(name, { channel: parent.id }),
                ].slice(0, MAX_NEXT),
              );
            }
            const facts = messageTypeFacts(db, type);
            const field = input.field?.trim() || undefined;
            const selected = key === 'producers' ? [...facts.producers] : facts.selectors.map((selector) => selector.consumer);
            // Asked for a field of a type nothing selects: the handlers that take every type read it, if any do.
            const candidates =
              field !== undefined && key === 'consumers' && selected.length === 0
                ? facts.receivers.filter((receiver) => receiver.takes === 'generic').map((receiver) => receiver.consumer)
                : selected;
            const ends = fieldsOfEnds(db, key, candidates.filter(inService(input.service)).sort(byId), parent.id, wanted, field, detail);
            const nodes = ends.kept;
            const { items, total, truncated, nextOffset } = truncate(nodes, maxNodes, input.offset);
            const said = key === 'consumers' ? unselectedSaid(facts) : undefined;
            const maybe = key === 'producers' && facts.producers.length === 0 ? facts.unreadProducers : [];
            const args = { channel: parent.id, type: wanted, field, service: input.service, detail: input.detail, maxNodes };
            const rows = items.map((node) => ({
              ...(key === 'consumers' ? selectorRow(db, facts, node, detail, reader) : reader.annotate(projectDetail(node, detail))),
              ...ends.extra.get(node.id),
            }));
            return withNext(
              {
                channel: projectDetail(parent, detail),
                [key]: rows,
                total,
                ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
                ...used,
                type: wanted,
                ...(field === undefined ? {} : { field }),
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
                ...completeOf([
                  pageLeft(total, items.length, input.offset, nextOffset),
                  key === 'producers' && unreadSaid(facts.unreadProducers.length, parent.label, wanted),
                  said?.sureness === 'unsure' && `unsure: ${said.said}`,
                  ...ends.left,
                  ...reader.left(),
                ]),
              },
              pagedNext(
                { tool: name, args, nextOffset },
                withoutShown(
                  [
                    ...(field === undefined ? [] : [callOf('check_contract', { channel: parent.id, type: wanted, field })]),
                    callOf(other, { channel: parent.id, type: wanted, field }),
                    ...(said === undefined ? [] : [callOf('who_consumes', { channel: parent.id })]),
                    ...nextFor(items[0]),
                  ],
                  rows,
                ).slice(0, 4),
              ),
            );
          }

          // A publisher points at the channel; the channel points at a handler.
          const edges =
            key === 'producers' ? db.edgesTo(id, ['emits']) : db.edgesFrom(id, ['consumes']);
          const field = input.field?.trim() || undefined;
          const ends = fieldsOfEnds(
            db,
            key,
            edges
              .map((edge) => db.node(key === 'producers' ? edge.from : edge.to))
              .filter((node) => node !== undefined)
              .filter(inService(input.service))
              .sort(byId),
            id,
            undefined,
            field,
            detail,
          );
          const nodes = ends.kept;

          const { items, total, truncated, nextOffset } = truncate(nodes, maxNodes, input.offset);
          const rows = items.map((node) => ({ ...reader.annotate(projectDetail(node, detail)), ...ends.extra.get(node.id) }));
          const args = { channel: id, field, service: input.service, detail: input.detail, maxNodes };
          // The types it carries, each a question of its own (P358).
          const values = typeValues(db, id);
          return withNext(
            {
              channel: projectDetail(channel, detail),
              [key]: rows,
              total,
              ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
              ...used,
              ...(field === undefined ? {} : { field }),
              ...(values.length === 0 ? {} : { types: values }),
              ...completeOf([pageLeft(total, items.length, input.offset, nextOffset), ...ends.left, ...reader.left()]),
              ...(note === undefined ? {} : { note }),
            },
            pagedNext(
              { tool: name, args, nextOffset },
              withoutShown(
                [
                  ...(field === undefined ? [] : [callOf('check_contract', { channel: id, field })]),
                  ...(values[0] === undefined ? [] : [callOf(name, { channel: id, type: values[0], field })]),
                  callOf(other, { channel: id, field }),
                  ...nextFor(items[0]),
                ],
                rows,
              ).slice(0, 4),
            ),
          );
        }),
    );
  };

  ends(
    'who_emits',
    'Who publishes to a channel',
    'What publishes on a channel, in every repository. A name written as code (`tenant:<id>:events`, `{id}`, `:id`) answers for the channel it denotes (`channelUsed`); `type` keeps the publishes of one message type, `field` those sending it.',
    'producers',
  );
  ends(
    'who_consumes',
    'Who handles a channel',
    'What handles a channel; empty means nothing does. A name written as code answers for the channel it denotes (`channelUsed`); `type` keeps the handlers that select one message type, or says `unselected` with its `sureness`, `field` those reading it (`readIn`).',
    'consumers',
  );
};
