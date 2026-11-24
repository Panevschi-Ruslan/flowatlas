import { isMessageTypeNode, makeMessageTypeId, type GraphNode } from '@flowatlas/core';
import { messageTypeFacts, messageTypesOn, type GraphDb } from '@flowatlas/linker';
import { resolveChannelRef } from '../query/channel-ref.js';
import { projectDetail } from '../query/detail.js';
import {
  consumerReading,
  fieldNames,
  isWrapping,
  producerSends,
  readsField,
  requestPath,
  shapeFields,
  topField,
  unwrapped,
  unreadIn,
  type Reading,
} from '../query/fields.js';
import { nearNames } from '../query/names.js';
import { withNext } from '../query/next.js';
import type { ReachReader } from '../query/ways-in.js';
import { callOf, completeOf } from './common.js';

/**
 * The fields a crossing carries, set against what each end does with them
 * (P368): a field the receiving code reads and the sending code does not
 * send (`missing`), and one sent and read by nothing (`unused`), each with
 * where. Answered for a channel or one type of message on it, and for the
 * body of a request into a route, whose readers are the handler and every
 * guard, interceptor, pipe and middleware the route runs first.
 */

/** How many ids a row names before it counts the rest. */
const MOST_NAMED = 5;

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A field read with nothing to send it, at the first place it is read. */
interface Missing {
  field: string;
  id: string;
  line: number;
  /** The senders that do not send it, where some do. */
  notSentBy?: string[];
}

interface Unused {
  field: string;
  sentBy: string[];
}

/** One sender and what it sends, or undefined where its shape was not read. */
interface Sender {
  id: string;
  sends: string[] | undefined;
}

/** One receiver and what it reads. */
interface Receiver {
  id: string;
  label: string;
  reading: Reading;
}

/** The fields read and not sent, and sent and never read, between senders and receivers. */
export const compareFields = (
  senders: readonly Sender[],
  receivers: readonly Receiver[],
  field: string | undefined,
  named: (use: { id: string }) => string,
): { missing: Missing[]; unused: Unused[]; left: string[] } => {
  const left: string[] = [];
  const known = senders.filter((sender): sender is { id: string; sends: string[] } => sender.sends !== undefined);
  for (const sender of senders) if (sender.sends === undefined) left.push(`unsure: ${sender.id} sends a shape not read`);
  for (const receiver of receivers) {
    if (!receiver.reading.known) left.push(`unread: ${receiver.label} was not read for the fields it reads`);
    for (const use of receiver.reading.unread) left.push(`unsure: ${named(use)}: ${use.why}, line ${use.line}`);
  }
  const missing: Missing[] = [];
  const seen = new Set<string>();
  const readAnywhere = new Set<string>();
  const sentAnywhere = new Set(known.flatMap((sender) => sender.sends));
  for (const receiver of receivers) {
    for (const site of receiver.reading.reads) {
      // A read through a wrapping no sender sends (`job.data.label`) is a read of the message inside it.
      let name = topField(site.field);
      if (!sentAnywhere.has(name)) {
        const inner = unwrapped(site.field);
        if (inner !== undefined) name = topField(inner);
        else if (isWrapping(name)) continue;
      }
      readAnywhere.add(name);
      if (field !== undefined && !readsField(site.field, field) && name !== field) continue;
      if (seen.has(`${name}|${receiver.id}`) || known.length === 0) continue;
      seen.add(`${name}|${receiver.id}`);
      const lacking = known.filter((sender) => !sender.sends.includes(name)).map((sender) => sender.id);
      if (lacking.length === 0) continue;
      missing.push({
        field: name,
        id: site.id,
        line: site.line,
        ...(lacking.length === known.length ? {} : { notSentBy: lacking.slice(0, MOST_NAMED) }),
      });
    }
  }
  // Only a receiver read in full can say a field goes unread.
  const settled = receivers.length > 0 && receivers.every((receiver) => receiver.reading.known);
  const unused: Unused[] = [];
  if (settled) {
    const by = new Map<string, string[]>();
    for (const sender of known) {
      for (const name of sender.sends) {
        if (readAnywhere.has(name) || (field !== undefined && name !== topField(field))) continue;
        by.set(name, [...(by.get(name) ?? []), sender.id]);
      }
    }
    for (const [name, ids] of [...by].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) unused.push({ field: name, sentBy: ids.slice(0, MOST_NAMED) });
    if (receivers.some((receiver) => receiver.reading.unread.length > 0) && unused.length > 0) {
      left.push('unsure: a receiver hands the value where it is not read, so a field said unused may be read there');
    }
  }
  return { missing, unused, left };
};

/**
 * The channels that carry a type of message written as `value` (P382): an
 * agent that knows the message (`HELP_REQUESTED`) and not the channel it
 * travels on writes it as the channel. The type as written first, then
 * written in another case; by channel id.
 */
export const channelsCarrying = (db: GraphDb, value: string): Array<{ channel: string; type: string }> => {
  const wanted = value.trim();
  if (wanted === '') return [];
  const types = db.nodesByType('channel').filter(isMessageTypeNode);
  const said = (node: GraphNode): string => String(node.meta?.['messageType'] ?? node.label);
  const exact = types.filter((node) => said(node) === wanted);
  const found = exact.length > 0 ? exact : types.filter((node) => said(node).toLowerCase() === wanted.toLowerCase());
  return found
    .map((node) => ({ channel: String(node.meta?.['channel'] ?? ''), type: said(node) }))
    .filter((one) => one.channel !== '' && db.node(one.channel) !== undefined)
    .sort((a, b) => (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0));
};

/**
 * `check_contract({channel, type?, field?})`: every publish and every
 * handler of the channel (or of the type), what each sends and reads, and
 * where they disagree.
 */
export const channelContract = (
  db: GraphDb,
  reader: ReachReader,
  input: { channel: string; type?: string | undefined; field?: string | undefined; maxNodes: number },
): object => {
  const found = resolveChannelRef(db, input.channel);
  if (found === undefined || 'candidates' in found) {
    // No channel of that name (P382): the nearest channels, each as the call to make.
    const channels = db.nodesByType('channel').filter((node) => !isMessageTypeNode(node));
    const close = found === undefined ? nearNames(channels, input.channel, 3) : found.candidates;
    // Nothing near: the channels there are, a few, so the next call is one of them and not a search.
    const near = close.length > 0 ? close : [...channels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 3);
    return withNext(
      {
        error: found === undefined ? `no channel or type of message ${JSON.stringify(input.channel.trim())}` : `${JSON.stringify(input.channel.trim())} fits ${found.candidates.length} channels; ask for one of them`,
        ...(found === undefined && near.length > 0 ? { [close.length > 0 ? 'near' : 'channels']: near.map((node) => node.id) } : {}),
      },
      near.slice(0, 2).map((node) => callOf('check_contract', { channel: node.id, type: input.type, field: input.field })),
    );
  }
  const parent = isMessageTypeNode(found.node) ? (db.node(String(found.node.meta?.['channel'] ?? '')) ?? found.node) : found.node;
  const wanted = input.type?.trim() || (isMessageTypeNode(found.node) ? String(found.node.meta?.['messageType'] ?? '') : undefined) || undefined;
  const field = input.field?.trim() || undefined;
  const left: string[] = [];
  let producers: GraphNode[];
  let consumers: GraphNode[];
  if (wanted !== undefined) {
    const typeNode = db.node(makeMessageTypeId(parent.id, wanted));
    if (typeNode === undefined) {
      const types = messageTypesOn(db, parent.id).map((node) => String(node.meta?.['messageType'] ?? node.label));
      return withNext(
        { error: `no type ${JSON.stringify(wanted)} is read on ${parent.label}`, ...(types.length === 0 ? {} : { types }) },
        types.slice(0, 2).map((value) => callOf('check_contract', { channel: parent.id, type: value, field })),
      );
    }
    const facts = messageTypeFacts(db, typeNode);
    producers = [...facts.producers];
    const generic = facts.receivers.filter((receiver) => receiver.takes === 'generic').map((receiver) => receiver.consumer);
    consumers = [...new Map([...facts.selectors.map((selector) => selector.consumer), ...generic].map((node) => [node.id, node])).values()];
    if (facts.unreadProducers.length > 0) left.push(`unsure: ${facts.unreadProducers.length} publish(es) on ${parent.label} send a type not read; any may be ${wanted}`);
    for (const receiver of facts.receivers) if (receiver.takes === 'unread') left.push(`unsure: ${receiver.consumer.label} chooses by a type not read${receiver.why === undefined ? '' : ` (${receiver.why})`}`);
  } else {
    producers = db.edgesTo(parent.id, ['emits']).flatMap((edge) => db.node(edge.from) ?? []);
    consumers = db.edgesFrom(parent.id, ['consumes']).flatMap((edge) => db.node(edge.to) ?? []);
  }
  producers.sort(byId);
  consumers.sort(byId);
  const senders: Sender[] = producers.map((node) => ({ id: node.id, sends: producerSends(db, node, parent.id, wanted) }));
  const receivers: Receiver[] = consumers.map((node) => ({ id: node.id, label: node.label, reading: consumerReading(db, node, wanted) }));
  const compared = wanted === undefined ? byType(db, parent.id, consumers, field) : undefined;
  const { missing, unused, left: unsure } = compared ?? compareFields(senders, receivers, field, (use) => unreadIn(db, use));
  const shownProducers = producers.slice(0, input.maxNodes);
  const shownConsumers = consumers.slice(0, input.maxNodes);
  if (shownProducers.length < producers.length) left.push(`page: ${producers.length - shownProducers.length} more producers; raise maxNodes`);
  if (shownConsumers.length < consumers.length) left.push(`page: ${consumers.length - shownConsumers.length} more consumers; raise maxNodes`);
  const only = (names: readonly string[]): string[] => (field === undefined ? [...names] : names.filter((name) => readsField(name, field)));
  return withNext(
    {
      channel: parent.id,
      ...(wanted === undefined ? {} : { type: wanted }),
      ...(field === undefined ? {} : { field }),
      producers: shownProducers.map((node, index) => {
        const sends = senders[index]?.sends;
        return { ...reader.annotate(projectDetail(node, 1)), ...(sends === undefined ? {} : { sends: only(sends) }) };
      }),
      consumers: shownConsumers.map((node, index) => {
        const reading = receivers[index]!.reading;
        return { ...reader.annotate(projectDetail(node, 1)), ...(reading.known ? { reads: only(fieldNames(reading)) } : {}) };
      }),
      missing,
      unused,
      ...completeOf([...unsure, ...left, ...reader.left()]),
    },
    wanted === undefined ? [] : [callOf('who_consumes', { channel: parent.id, type: wanted, field })],
  );
};

/**
 * A channel that carries types of message, compared type by type: what a
 * handler reads under one type is set only against what publishes that type
 * send. Undefined for a channel that carries no types read.
 */
const byType = (
  db: GraphDb,
  channel: string,
  consumers: readonly GraphNode[],
  field: string | undefined,
): { missing: Array<Missing & { type?: string }>; unused: Array<Unused & { type?: string }>; left: string[] } | undefined => {
  const types = messageTypesOn(db, channel);
  if (types.length === 0) return undefined;
  const missing: Array<Missing & { type?: string }> = [];
  const unused: Array<Unused & { type?: string }> = [];
  const left = new Set<string>();
  const seen = new Set<string>();
  for (const typeNode of types) {
    const facts = messageTypeFacts(db, typeNode);
    const value = facts.value;
    // The channel's own handlers, and those that take this type alone without a chooser among them.
    const own = new Set(consumers.map((node) => node.id));
    const takers = [
      ...consumers,
      ...facts.selectors.filter((selector) => !own.has(selector.selectedBy ?? '') && !own.has(selector.consumer.id)).map((selector) => selector.consumer),
    ];
    const compared = compareFields(
      facts.producers.map((node) => ({ id: node.id, sends: producerSends(db, node, channel, value) })),
      takers.map((node) => ({ id: node.id, label: node.label, reading: consumerReading(db, node, value) })),
      field,
      (use) => unreadIn(db, use),
    );
    for (const row of compared.missing) {
      const key = `${row.field}|${row.id}|${row.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push({ type: value, ...row });
    }
    for (const row of compared.unused) unused.push({ type: value, ...row });
    for (const said of compared.left) left.add(said);
  }
  const untyped = db.edgesTo(channel, ['emits']).filter((edge) => {
    const said = db.node(edge.from)?.meta?.['messageTypes'];
    return !Array.isArray(said) || said.length === 0;
  }).length;
  if (untyped > 0) left.add(`unsure: ${untyped} publish(es) on the channel send a type not read, not compared`);
  return { missing, unused, left: [...left] };
};

/** One read of the body on a request's path: the field, where, the layer it runs in, and how sure. */
interface BodyRead {
  field: string;
  id: string;
  line: number;
  layer: string;
  sureness?: string;
}

/**
 * What the code a request to `entry` runs through reads of its body: the
 * handler and every guard, interceptor, pipe and middleware before it.
 */
export const bodyReadsOf = (db: GraphDb, entry: string, field: string | undefined): { reads: BodyRead[]; names: string[]; left: string[]; reading: Reading } => {
  const reads: BodyRead[] = [];
  const left: string[] = [];
  const all: Reading = { known: true, reads: [], unread: [] };
  for (const step of requestPath(db, entry)) {
    const label = db.node(step.id)?.label ?? step.id;
    if (!step.reading.known) {
      left.push(`unread: ${step.layer} ${label} was not read for the fields it reads`);
      all.known = false;
      continue;
    }
    // The method the use is in, not only the class a guard's rows are written on (P374).
    for (const use of step.reading.unread) left.push(`unsure: ${step.layer} ${unreadIn(db, use)}: ${use.why}, line ${use.line}`);
    all.reads.push(...step.reading.reads);
    all.unread.push(...step.reading.unread);
    for (const site of step.reading.reads) {
      if (field !== undefined && !readsField(site.field, field)) continue;
      reads.push({ field: site.field, id: site.id, line: site.line, layer: step.layer, ...(site.sureness === undefined ? {} : { sureness: site.sureness }) });
    }
  }
  return { reads, names: fieldNames(all), left, reading: all };
};

/** What a request sends as the body, against what the route's path reads of it. */
export const requestFields = (
  db: GraphDb,
  caller: { id: string; params?: readonly string[] | undefined },
  entry: string,
  field: string | undefined,
): { missing: Missing[]; unused: Unused[]; left: string[] } | undefined => {
  const sends = shapeFields(db, caller.params?.[0]);
  const path = bodyReadsOf(db, entry, undefined);
  if (sends === undefined) return path.reading.reads.length === 0 ? undefined : { missing: [], unused: [], left: [`unsure: the body ${caller.id} sends is a shape not read`] };
  const compared = compareFields([{ id: caller.id, sends }], [{ id: entry, label: db.node(entry)?.label ?? entry, reading: path.reading }], field, (use) => unreadIn(db, use));
  return { ...compared, left: [...new Set([...compared.left, ...path.left])] };
};
