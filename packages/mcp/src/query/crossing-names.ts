import { DISCRIMINATOR_FIELDS, isMessageTypeNode, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { messageTypeFacts, type GraphDb } from '@flowatlas/linker';
import { bodyReadsOf } from '../tools/fields-contract.js';
import { consumerReading, producerSends, shapeFields, topField, type FieldSite } from './fields.js';

/**
 * The names written in one file that code in another repository depends on
 * (P387), for the hook that reads an edit: a route declared there that
 * another service calls, a deployed function another starts, a channel or a
 * type of message published or taken there that another service takes or
 * publishes, and a field of a message or a request body sent there that the
 * other side reads, or read there that the other side sends.
 *
 * Each says where it is written (the file and line the graph has), the text an
 * edit would remove (`literal`; none for a route, whose declaring line the
 * command line reads off the file), how it is said, and who uses it, by
 * service, function and place. Everything in one repository is a search's to
 * find; only what crosses is here.
 */

export type CrossingKind = 'route' | 'function' | 'channel' | 'message type' | 'field';

/** What the code on the far side does with the name. */
export type CrossingRole = 'called by' | 'started by' | 'consumed by' | 'published by' | 'read by' | 'sent by';

export interface CrossingName {
  service: string;
  /** Repository-relative, as the graph has it. */
  file: string;
  line: number;
  kind: CrossingKind;
  /** The text an edit takes out to remove the name; undefined for a route. */
  literal?: string;
  /** How the name is said: `PATCH /api/orders/:id/cancel`, `deskNumber, sent on desk_events HELP_REQUESTED`. */
  said: string;
  role: CrossingRole;
  /** The uses in other services, nearest named first: `ops-bot NotifyService.page (src/notify/notify.service.ts:20)`. */
  users: string[];
  /** The node the graph's tools take about it. */
  id: string;
}

/** Nodes that are a place in code rather than code: a request, a browser's call, a publish. */
const SITES: ReadonlySet<string> = new Set(['http_out', 'ui_api_call', 'producer']);

/** The function a request or a publish is made in, as a person names it; the node's own label otherwise. */
const ownerOf = (db: GraphDb, node: GraphNode): GraphNode => {
  // A request, a browser's call or a publish is a site; the function holding it is what a person names.
  if (!SITES.has(node.type)) return node;
  const owner = db
    .edgesTo(node.id)
    .map((edge) => db.node(edge.from))
    .find((from) => from !== undefined && (from.type === 'method' || from.type === 'function'));
  return owner ?? node;
};

const placeOf = (file: string | undefined, line: number | undefined): string =>
  file === undefined ? '' : ` (${file}${line === undefined ? '' : `:${line}`})`;

/** A route as its code writes it, parameters by their names: `PATCH /api/orders/:id/cancel`. */
const routeSaid = (entry: GraphNode): string => {
  const method = entry.meta?.['method'];
  const path = entry.meta?.['rawPath'] ?? entry.meta?.['path'];
  return typeof method === 'string' && typeof path === 'string' ? `${method} ${path}` : entry.label;
};

/** A use as the hook names it: its service, its function and where. */
const userOf = (db: GraphDb, node: GraphNode, at?: { file?: string | undefined; line?: number | undefined }): string => {
  const owner = ownerOf(db, node);
  return `${node.repo} ${owner.label}${placeOf(at?.file ?? node.file, at?.line ?? node.line)}`;
};

const siteUser = (db: GraphDb, site: FieldSite): string => {
  const node = db.node(site.id);
  return node === undefined ? site.id : `${node.repo} ${node.label}${placeOf(node.file, site.line)}`;
};

/** Every name in the graph that an edit in its file could break elsewhere. */
export const crossingNamesOf = (db: GraphDb): CrossingName[] => {
  const found = new Map<string, CrossingName>();
  const add = (name: Omit<CrossingName, 'users'>, users: readonly string[]): void => {
    if (users.length === 0 || name.file === '' || name.service === '') return;
    const key = [name.service, name.file, name.kind, name.literal ?? name.id, name.role].join('\n');
    const held = found.get(key);
    if (held === undefined) found.set(key, { ...name, users: [...new Set(users)] });
    else held.users = [...new Set([...held.users, ...users])];
  };
  const elsewhere = (service: string | undefined) => (node: GraphNode | undefined): node is GraphNode =>
    node !== undefined && node.repo !== undefined && node.repo !== service;

  for (const entry of db.nodesByType('entry')) {
    if (entry.file === undefined || entry.line === undefined) continue;
    if (entry.kind === 'http') {
      const calls = db.edgesTo(entry.id, ['http_calls', 'hits']).filter((edge) => elsewhere(entry.repo)(db.node(edge.from)));
      add(
        { service: entry.repo, file: entry.file, line: entry.line, kind: 'route', said: routeSaid(entry), role: 'called by', id: entry.id },
        calls.map((edge) => userOf(db, db.node(edge.from)!, edge)),
      );
      bodyFields(db, entry, calls, add);
    } else if (entry.kind === 'invoke' && typeof entry.meta?.['key'] === 'string') {
      const starters = db.edgesTo(entry.id).filter((edge) => elsewhere(entry.repo)(db.node(edge.from)));
      add(
        { service: entry.repo, file: entry.file, line: entry.line, kind: 'function', literal: entry.meta['key'] as string, said: entry.meta['key'] as string, role: 'started by', id: entry.id },
        starters.map((edge) => userOf(db, db.node(edge.from)!, edge)),
      );
    }
  }

  const channels = db.nodesByType('channel');
  // The channels a type of message is read on, once (P396): asked per channel, it read every channel each time.
  const typed = new Set(channels.flatMap((node) => (isMessageTypeNode(node) && typeof node.meta?.['channel'] === 'string' ? [node.meta['channel']] : [])));
  for (const channel of channels) {
    if (isMessageTypeNode(channel)) {
      messageNames(db, channel, add);
      continue;
    }
    const emits = db.edgesTo(channel.id, ['emits']);
    const takes = db.edgesFrom(channel.id, ['consumes']);
    for (const edge of emits) {
      const producer = db.node(edge.from);
      if (producer?.file === undefined) continue;
      const far = takes.map((take) => db.node(take.to)).filter(elsewhere(producer.repo));
      const at = { service: producer.repo, file: edge.file ?? producer.file, line: edge.line ?? producer.line ?? 0, kind: 'channel' as const, literal: channel.label, said: channel.label, id: channel.id };
      add({ ...at, role: 'consumed by' }, far.map((node) => userOf(db, node)));
    }
    for (const edge of takes) {
      const consumer = db.node(edge.to);
      if (consumer?.file === undefined) continue;
      const far = emits.map((emit) => db.node(emit.from)).filter(elsewhere(consumer.repo));
      add(
        { service: consumer.repo, file: consumer.file, line: consumer.line ?? 0, kind: 'channel', literal: channel.label, said: channel.label, role: 'published by', id: channel.id },
        far.map((node) => userOf(db, node)),
      );
    }
    // A channel that carries no type read: its fields compared publish by publish.
    if (typed.has(channel.id)) continue;
    const producers = emits.flatMap((edge) => db.node(edge.from) ?? []);
    const consumers = takes.flatMap((edge) => db.node(edge.to) ?? []);
    messageFields(db, { channelId: channel.id, channelLabel: channel.label, id: channel.id }, producers, consumers, add);
  }
  return [...found.values()].sort((a, b) =>
    a.service !== b.service ? (a.service < b.service ? -1 : 1) : a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line || (a.said < b.said ? -1 : a.said > b.said ? 1 : 0),
  );
};

type Add = (name: Omit<CrossingName, 'users'>, users: readonly string[]) => void;

/** A type of message: its value where it is published and where it is chosen, and its fields. */
const messageNames = (db: GraphDb, typeNode: GraphNode, add: Add): void => {
  const facts = messageTypeFacts(db, typeNode);
  const channel = facts.channel;
  if (channel === undefined) return;
  const takers = [
    ...new Map(
      [...facts.selectors.map((selector) => selector.consumer), ...facts.receivers.filter((receiver) => receiver.takes === 'generic').map((receiver) => receiver.consumer)].map((node) => [node.id, node]),
    ).values(),
  ];
  const said = `${facts.value} (on ${channel.label})`;
  for (const producer of facts.producers) {
    if (producer.file === undefined) continue;
    const far = takers.filter((node) => node.repo !== producer.repo);
    add({ service: producer.repo, file: producer.file, line: producer.line ?? 0, kind: 'message type', literal: facts.value, said, role: 'consumed by', id: typeNode.id }, far.map((node) => userOf(db, node)));
  }
  for (const selector of facts.selectors) {
    const consumer = selector.consumer;
    // Where the choice is written: the consumer that chose it, or the consumer itself.
    const chooser = (selector.selectedBy === undefined ? undefined : db.node(selector.selectedBy)) ?? consumer;
    if (chooser.file === undefined) continue;
    const far = facts.producers.filter((node) => node.repo !== chooser.repo);
    add({ service: chooser.repo, file: chooser.file, line: chooser.line ?? 0, kind: 'message type', literal: facts.value, said, role: 'published by', id: typeNode.id }, far.map((node) => userOf(db, node)));
  }
  messageFields(db, { channelId: channel.id, channelLabel: channel.label, type: facts.value, id: typeNode.id }, facts.producers, takers, add);
};

/** The fields one publish sends that a handler in another service reads, said on both ends. */
const messageFields = (
  db: GraphDb,
  where: { channelId: string; channelLabel: string; type?: string; id: string },
  producers: readonly GraphNode[],
  consumers: readonly GraphNode[],
  add: Add,
): void => {
  const { channelId, channelLabel, type, id } = where;
  const on = `sent on ${channelLabel}${type === undefined ? '' : ` ${type}`}`;
  for (const producer of producers) {
    if (producer.file === undefined) continue;
    const sends = producerSends(db, producer, channelId, type);
    if (sends === undefined) continue;
    for (const consumer of consumers) {
      if (consumer.repo === producer.repo) continue;
      const reading = consumerReading(db, consumer, type);
      // The discriminator is the type of message, said as one: its value, not its key, is what an edit changes.
      for (const field of sends.filter((name) => type === undefined || !(DISCRIMINATOR_FIELDS as readonly string[]).includes(name))) {
        const sites = reading.reads.filter((site) => topField(site.field) === field);
        if (sites.length === 0) continue;
        add({ service: producer.repo, file: producer.file, line: producer.line ?? 0, kind: 'field', literal: field, said: `${field}, ${on}`, role: 'read by', id }, sites.map((site) => siteUser(db, site)));
        for (const site of sites) {
          const reader = db.node(site.id);
          if (reader?.file === undefined) continue;
          add({ service: reader.repo, file: reader.file, line: site.line, kind: 'field', literal: field, said: `${field}, ${on}`, role: 'sent by', id }, [userOf(db, producer)]);
        }
      }
    }
  }
};

/** The fields a request's body carries that the route's code reads, said on both ends. */
const bodyFields = (db: GraphDb, entry: GraphNode, calls: readonly GraphEdge[], add: Add): void => {
  if (calls.length === 0) return;
  const path = bodyReadsOf(db, entry.id, undefined);
  if (path.reading.reads.length === 0) return;
  const on = `in the body of ${routeSaid(entry)}`;
  for (const call of calls) {
    const caller = db.node(call.from);
    const sends = shapeFields(db, call.params?.[0]);
    if (caller === undefined || sends === undefined) continue;
    const file = call.file ?? caller.file;
    for (const field of sends) {
      const sites = path.reading.reads.filter((site) => topField(site.field) === field);
      if (sites.length === 0) continue;
      if (file !== undefined) {
        add({ service: caller.repo, file, line: call.line ?? caller.line ?? 0, kind: 'field', literal: field, said: `${field}, ${on}`, role: 'read by', id: entry.id }, sites.map((site) => siteUser(db, site)));
      }
      for (const site of sites) {
        const reader = db.node(site.id);
        if (reader?.file === undefined) continue;
        add({ service: reader.repo, file: reader.file, line: site.line, kind: 'field', literal: field, said: `${field}, ${on}`, role: 'sent by', id: entry.id }, [userOf(db, caller, call)]);
      }
    }
  }
};
