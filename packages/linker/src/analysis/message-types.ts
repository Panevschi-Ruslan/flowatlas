import {
  FORWARDS_UNREAD_META,
  HANDS_ON_META,
  isMessageTypeNode,
  MESSAGE_TYPE_UNREAD_META,
  messageTypesOf,
  RELAYS_UNREAD_META,
  SELECTED_BY_META,
  SELECTION_UNREAD_META,
  selectionsOf,
  STREAM_KIND,
  SUBSCRIPTIONS_META,
  UNREACHED_META,
  type GraphEdge,
  type GraphNode,
} from '@flowatlas/core';
import { EVERY_CHANNEL_VIA } from '../every-channel-link.js';

/**
 * What is known about one type of message on a channel (P358), asked the same
 * way by the linker's finding, `dead` and the MCP server, so the three cannot
 * disagree.
 */

/** The four questions this asks of a graph, which a database and the linker's maps both answer. */
export interface MessageTypeLookup {
  node(id: string): GraphNode | undefined;
  edgesTo(id: string, types?: readonly string[]): GraphEdge[];
  edgesFrom(id: string, types?: readonly string[]): GraphEdge[];
  nodesByType(type: string): GraphNode[];
}

/** A consumer of the channel a type is on, and what it does with types. */
export interface ChannelReceiver {
  readonly consumer: GraphNode;
  /** Why it never runs, where its handler's class is built by nothing. */
  readonly unreached?: string;
  /**
   * `selects` it chooses by type (and not this one, where it is asked about a
   * type nothing selects); `generic` it reads no type and takes every one
   * alike; `unread` its choice, or its code, was not read.
   */
  readonly takes: 'selects' | 'generic' | 'unread';
  /** Why, where it was not read. */
  readonly why?: string;
}

/** One handler that selects a type. */
export interface TypeSelector {
  readonly consumer: GraphNode;
  readonly edge: GraphEdge;
  /** The consumer whose handler made the choice, where it is not this one. */
  readonly selectedBy?: string;
  /** Why it never runs, where its class is built by nothing. */
  readonly unreached?: string;
}

export interface MessageTypeFacts {
  readonly type: GraphNode;
  readonly channel: GraphNode | undefined;
  readonly value: string;
  readonly producers: readonly GraphNode[];
  readonly selectors: readonly TypeSelector[];
  /** The consumers of the channel, by what each does with types. */
  readonly receivers: readonly ChannelReceiver[];
  /** Producers on the channel whose payload's type was not read: any of them may send this one. */
  readonly unreadProducers: readonly GraphNode[];
  /**
   * Consumers choosing this type elsewhere that receive channels not all read
   * (P400): a stream route relaying a channel not read, a hub written to with
   * one. Any of those may be this channel, so "nothing selects it" is not
   * sure. Asked only where nothing live selects it on this channel.
   */
  readonly relayed: readonly RelayedChooser[];
}

/** A consumer choosing a type whose channels are not known whole, and why. */
export interface RelayedChooser {
  readonly consumer: GraphNode;
  readonly why: string;
}

/** The class a method's id names, by id: `<repo>#<file>:<Class>.<method>` gives `<repo>#<file>:<Class>`. */
const classIdOf = (symbol: string): string | undefined => {
  const cut = symbol.lastIndexOf(':');
  const dot = symbol.lastIndexOf('.');
  return cut < 0 || dot < cut ? undefined : symbol.slice(0, dot);
};

/** How many choosers back the code that makes a consumer's subscription is looked for. */
const MOST_CHOOSERS = 3;

/**
 * The code a consumer's subscription is made in (P374): the function a
 * consumer that records where it subscribes (`subscriptions`) hands to - the
 * method whose body calls `subscribe` - or, for a consumer a chooser's
 * dispatch drew (`selectedBy`), its chooser's. Undefined for a consumer a
 * framework subscribes for (a decorated handler), whose subscription no code
 * of the project makes.
 */
export const subscribingCode = (lookup: MessageTypeLookup, consumer: GraphNode, depth = 0): GraphNode | undefined => {
  const subscriptions = consumer.meta?.[SUBSCRIPTIONS_META];
  if (Array.isArray(subscriptions) && subscriptions.length > 0) {
    const [handles] = lookup.edgesFrom(consumer.id, ['handles']);
    const handler = handles === undefined ? undefined : lookup.node(handles.to);
    return handler !== undefined && (handler.type === 'method' || handler.type === 'function') ? handler : undefined;
  }
  const chooser = consumer.meta?.[SELECTED_BY_META];
  if (typeof chooser !== 'string' || depth >= MOST_CHOOSERS) return undefined;
  const node = lookup.node(chooser);
  return node === undefined ? undefined : subscribingCode(lookup, node, depth + 1);
};

/** The edges by which code outside a class reaches one of its methods. */
const REACHING_EDGES = ['calls', 'handles', 'triggers', 'guarded_by'] as const;

/**
 * Why a consumer whose subscription is made in code never runs (P374): the
 * code is a method of a class nothing builds - no module registers it,
 * nothing injects or imports it - and nothing outside the class calls any of
 * its methods, so the method that subscribes never runs and what the
 * channel's publishers send never reaches the handler. Whoever else calls
 * what the handler calls (a toast every screen shows) does not make it run.
 */
const neverSubscribed = (lookup: MessageTypeLookup, consumer: GraphNode): string | undefined => {
  const code = subscribingCode(lookup, consumer);
  if (code === undefined || code.type !== 'method') return undefined;
  const classId = classIdOf(code.id);
  const owner = classId === undefined ? undefined : lookup.node(classId);
  if (owner === undefined || owner.type !== 'provider' || owner.kind === 'controller' || owner.kind === 'external') return undefined;
  if (owner.meta?.['module'] !== undefined || owner.meta?.['exported'] !== undefined) return undefined;
  if (lookup.edgesTo(owner.id).some((edge) => edge.type === 'injects' || edge.type === 'imports' || edge.type === 'calls' || edge.type === 'handles')) return undefined;
  const inClass = (id: string): boolean => id.startsWith(`${owner.id}.`);
  for (const method of lookup.nodesByType('method')) {
    if (!inClass(method.id)) continue;
    for (const edge of lookup.edgesTo(method.id, REACHING_EDGES)) {
      // A consumer handing its messages to the class is the subscription itself, not code that builds the class.
      if (inClass(edge.from) || lookup.node(edge.from)?.type === 'consumer') continue;
      return undefined;
    }
  }
  return `nothing builds ${owner.label} and nothing outside it calls ${code.label}, where the subscription is made`;
};

/**
 * Why the handler a consumer runs never runs: its class is a provider of a
 * service whose classes a container builds, and nothing builds it - no module
 * registers it and nothing injects it. Nothing where that cannot be said: a
 * class the container does not build, one a module exports, a plain function.
 *
 * A subscription a class makes when it starts is drawn wherever it is
 * written, which is right for every class something builds and wrong for one
 * nothing does; this is how that one is told apart.
 */
export const unreachedHandler = (lookup: MessageTypeLookup, consumer: GraphNode, modulesByRepo?: ReadonlySet<string>): string | undefined => {
  // Said by the reader that drew it: a screen subscribed through a service nothing makes (P362).
  const said = consumer.meta?.[UNREACHED_META];
  if (typeof said === 'string') return said;
  const unsubscribed = neverSubscribed(lookup, consumer);
  if (unsubscribed !== undefined) return unsubscribed;
  const [handles] = lookup.edgesFrom(consumer.id, ['handles']);
  const classId = handles === undefined ? undefined : classIdOf(handles.to);
  const owner = classId === undefined ? undefined : lookup.node(classId);
  if (owner === undefined || owner.type !== 'provider' || owner.kind === 'controller' || owner.kind === 'external') return undefined;
  const containerBuilt = modulesByRepo ?? new Set(lookup.nodesByType('module').map((node) => node.repo));
  if (!containerBuilt.has(owner.repo)) return undefined;
  if (owner.meta?.['module'] !== undefined) return undefined;
  if (lookup.edgesTo(owner.id, ['injects']).length > 0) return undefined;
  return `nothing builds ${owner.label}: no module registers it and nothing injects it`;
};

/** What a consumer of a channel does with the types on it. */
const receiverOf = (lookup: MessageTypeLookup, consumer: GraphNode, modulesByRepo?: ReadonlySet<string>): ChannelReceiver => {
  const unreached = unreachedHandler(lookup, consumer, modulesByRepo);
  const never = unreached === undefined ? {} : { unreached };
  if (selectionsOf(consumer).length > 0) return { consumer, takes: 'selects', ...never };
  const unread = consumer.meta?.[SELECTION_UNREAD_META];
  if (typeof unread === 'string') return { consumer, takes: 'unread', why: unread, ...never };
  const [handles] = lookup.edgesFrom(consumer.id, ['handles']);
  const handler = handles === undefined ? undefined : lookup.node(handles.to);
  // Only code that was read can be said to choose nothing.
  if (handler === undefined || (handler.type !== 'method' && handler.type !== 'function')) {
    return { consumer, takes: 'unread', why: 'its handler is not code this reads', ...never };
  }
  return { consumer, takes: 'generic', ...never };
};

/**
 * Whether a consumer only hands the channel's messages on to consumers that
 * are themselves on the channel (P362), so what they choose stands for it: a
 * route relaying the channel onto a stream that screens are joined to, and
 * the function a stream's frames arrive at that pushes them into a subject
 * the screens subscribe to. Counted as passing every type on, it would make
 * every "nothing selects this type" unsure though everything past it was read.
 */
const handsOnRead = (consumer: GraphNode, consuming: readonly GraphEdge[]): boolean => {
  const relay = consumer.meta?.['relay'];
  if (typeof relay === 'string' && consuming.some((edge) => edge.to !== consumer.id && edge.meta?.['route'] === relay)) return true;
  const handsOn = consumer.meta?.[HANDS_ON_META];
  // A generic stream class serves several wrappers: on this channel, those of its subscribers this channel reaches stand for it.
  return Array.isArray(handsOn) && handsOn.some((id) => consuming.some((edge) => edge.to === id));
};

/** Everything known about one type node. */
export const messageTypeFacts = (lookup: MessageTypeLookup, type: GraphNode, modulesByRepo?: ReadonlySet<string>): MessageTypeFacts => {
  const channelId = typeof type.meta?.['channel'] === 'string' ? type.meta['channel'] : undefined;
  const channel = channelId === undefined ? undefined : lookup.node(channelId);
  const value = typeof type.meta?.['messageType'] === 'string' ? type.meta['messageType'] : type.label;
  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const producers = lookup
    .edgesTo(type.id, ['emits'])
    .flatMap((edge) => lookup.node(edge.from) ?? [])
    .sort(byId);
  const selectors = lookup
    .edgesFrom(type.id, ['consumes'])
    .flatMap((edge): TypeSelector[] => {
      const consumer = lookup.node(edge.to);
      if (consumer === undefined) return [];
      const unreached = unreachedHandler(lookup, consumer, modulesByRepo);
      const selectedBy = typeof edge.meta?.['selectedBy'] === 'string' && edge.meta['selectedBy'] !== consumer.id ? edge.meta['selectedBy'] : undefined;
      return [{ consumer, edge, ...(selectedBy === undefined ? {} : { selectedBy }), ...(unreached === undefined ? {} : { unreached }) }];
    })
    .sort((a, b) => byId(a.consumer, b.consumer));
  const consuming = channel === undefined ? [] : lookup.edgesFrom(channel.id, ['consumes']);
  const receivers = consuming
    .flatMap((edge) => lookup.node(edge.to) ?? [])
    .filter((consumer) => !handsOnRead(consumer, consuming))
    .sort(byId)
    .map((consumer) => receiverOf(lookup, consumer, modulesByRepo));
  const unreadProducers =
    channel === undefined
      ? []
      : lookup
          .edgesTo(channel.id, ['emits'])
          .flatMap((edge) => lookup.node(edge.from) ?? [])
          .filter((producer) => typeof producer.meta?.[MESSAGE_TYPE_UNREAD_META] === 'string')
          .sort(byId);
  const live = selectors.some((selector) => selector.unreached === undefined);
  const relayed = live ? [] : relayedChoosers(lookup, value, new Set(selectors.map((selector) => selector.consumer.id)), modulesByRepo);
  return { type, channel, value, producers, selectors, receivers, unreadProducers, relayed };
};

/**
 * The consumers choosing a type whose channels are not known whole (P400),
 * those already selecting it on the channel asked about left out: the mirror
 * of P395's hold on `type-never-published`, asked by `receivedOf`.
 */
const relayedChoosers = (lookup: MessageTypeLookup, value: string, already: ReadonlySet<string>, modulesByRepo?: ReadonlySet<string>): RelayedChooser[] => {
  const out: RelayedChooser[] = [];
  for (const consumer of lookup.nodesByType('consumer')) {
    const chosen = selectionsOf(consumer).filter((selection) => selection.type === value && selection.heuristic !== true && !already.has(selection.consumer));
    if (chosen.length === 0) continue;
    // A handler that never runs chooses nothing that arrives.
    const running = chosen.some((selection) => {
      const handler = lookup.node(selection.consumer);
      return handler !== undefined && unreachedHandler(lookup, handler, modulesByRepo) === undefined;
    });
    if (!running) continue;
    const { notWhole } = receivedOf(lookup, consumer);
    if (notWhole !== undefined) out.push({ consumer, why: notWhole });
  }
  return out.sort((a, b) => (a.consumer.id < b.consumer.id ? -1 : a.consumer.id > b.consumer.id ? 1 : 0));
};

/**
 * What one channel a consumer receives carries, as far as its publishes say:
 * the types they send, or why that is not known whole.
 */
export interface ChannelCarries {
  channel: GraphNode;
  producers: number;
  types: ReadonlySet<string>;
  /** Why the types on it may not be all it carries. */
  unknown?: string;
  /** Why the channels a hub stands for may not all be read: a write to it hands it a channel not read. */
  forwardsUnread?: string;
}

/** The types a channel's publishes say they send, and whether that is all it may carry. */
export const carriesOf = (lookup: MessageTypeLookup, channel: GraphNode): ChannelCarries => {
  const producers = lookup.edgesTo(channel.id, ['emits']).flatMap((each) => lookup.node(each.from) ?? []);
  const types = new Set(producers.flatMap((producer) => messageTypesOf(producer)));
  const unread = producers.filter((producer) => typeof producer.meta?.[MESSAGE_TYPE_UNREAD_META] === 'string').length;
  const base = { channel, producers: producers.length, types };
  if (unread > 0) return { ...base, unknown: `${unread} publish(es) on ${channel.label} send a type not read` };
  // A hub that stands for the channels it is handed by name carries what they carry, where every write to it names one.
  const forwards = channel.meta?.['forwards'];
  const forwardsUnread = channel.meta?.[FORWARDS_UNREAD_META];
  if (typeof forwardsUnread === 'number' && forwardsUnread > 0) {
    const why = `${forwardsUnread} write(s) to ${channel.label} hand it a channel not read`;
    return { ...base, unknown: why, forwardsUnread: why };
  }
  if (Array.isArray(forwards) && forwards.length > 0) return base;
  if (producers.length === 0) return { ...base, unknown: `nothing publishing on ${channel.label} was read` };
  // A hub written to directly, its writes saying no type: what it hands its streams is not read.
  if (typeof channel.meta?.['heldBy'] === 'string' && types.size === 0) return { ...base, unknown: `the ${producers.length} write(s) to ${channel.label} say no type` };
  return base;
};

/** Why the channels a consumer receives may not be all of them: a stream route relaying channels not all read. */
export const channelsUnknown = (lookup: MessageTypeLookup, edges: readonly { meta?: Record<string, unknown> | undefined }[]): string | undefined => {
  for (const edge of edges) {
    if (edge.meta?.['via'] !== STREAM_KIND) continue;
    const route = typeof edge.meta['route'] === 'string' ? lookup.node(edge.meta['route']) : undefined;
    const why = route?.meta?.[RELAYS_UNREAD_META];
    if (typeof why === 'string') return why;
  }
  return undefined;
};

/** Every channel one consumer receives, what each carries, and why that set may not be whole. */
export interface Received {
  readonly channels: readonly GraphNode[];
  readonly carried: readonly ChannelCarries[];
  /**
   * Why the channels it receives may not be all of them (P395): a stream
   * route feeding it relays a channel not read, or a hub it receives is
   * written to with one.
   */
  readonly notWhole?: string;
}

/**
 * What a consumer receives (P395, P400), asked the same way by
 * `type-never-published` (is each type it chooses published on a channel it
 * receives?) and by "nothing selects this type" (could a consumer choosing it
 * be receiving this channel?). A subscriber to every channel of a bus did not
 * choose its channels, and they are left out.
 */
export const receivedOf = (lookup: MessageTypeLookup, consumer: GraphNode): Received => {
  const edges = lookup.edgesTo(consumer.id, ['consumes']).filter((edge) => edge.meta?.['via'] !== EVERY_CHANNEL_VIA);
  const channels = [
    ...new Map(
      edges
        .map((edge) => lookup.node(edge.from))
        .filter((channel): channel is GraphNode => channel !== undefined && channel.type === 'channel' && !isMessageTypeNode(channel))
        .map((channel) => [channel.id, channel] as const),
    ).values(),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const carried = channels.map((channel) => carriesOf(lookup, channel));
  const notWhole = channelsUnknown(lookup, edges) ?? carried.find((each) => each.forwardsUnread !== undefined)?.forwardsUnread;
  return { channels, carried, ...(notWhole === undefined ? {} : { notWhole }) };
};

/** The type nodes on one channel, by value. */
export const messageTypesOn = (lookup: MessageTypeLookup, channelId: string): GraphNode[] =>
  lookup
    .nodesByType('channel')
    .filter((node) => isMessageTypeNode(node) && node.meta?.['channel'] === channelId)
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

/** How sure "no code selects this type" is, and why, in one sentence. */
export interface Unselected {
  /** `sure`: every consumer of the channel was read and chooses by type; `unsure`: some forward every type on, or were not read. */
  readonly sureness: 'sure' | 'unsure' | 'no-consumer';
  readonly said: string;
  /**
   * Why the row is held back from the findings (P400): a consumer choosing
   * the type receives channels not all read, any of which may be this one.
   */
  readonly held?: string;
}

const named = (nodes: readonly { consumer: GraphNode }[], most = 2): string =>
  nodes
    .slice(0, most)
    .map((each) => each.consumer.label)
    .join(', ') + (nodes.length > most ? ` and ${nodes.length - most} more` : '');

/**
 * What to say of a type no live code selects (P358): who receives the channel
 * and what each does instead, so "nothing selects it" carries how sure it is.
 * Undefined where something live selects it.
 */
export const unselectedSaid = (facts: MessageTypeFacts): Unselected | undefined => {
  const live = facts.selectors.filter((selector) => selector.unreached === undefined);
  if (live.length > 0) return undefined;
  const channelName = facts.channel?.label ?? 'its channel';
  const parts: string[] = [];
  if (facts.selectors.length > 0) parts.push(`only ${named(facts.selectors)} selects it, and ${facts.selectors[0]!.unreached}`);
  const running = facts.receivers.filter((each) => each.unreached === undefined);
  const selecting = running.filter((each) => each.takes === 'selects');
  const generic = running.filter((each) => each.takes === 'generic');
  const unread = running.filter((each) => each.takes === 'unread');
  // A consumer choosing it elsewhere whose channels are not all read may be receiving this one (P400).
  const relayed = facts.relayed;
  const one = relayed.length === 1;
  const choosing = relayed.length === 0 ? undefined : `${named(relayed)} choose${one ? 's' : ''} it and receive${one ? 's' : ''} channels not all read (${relayed[0]!.why})`;
  const held = relayed.length === 0 ? {} : { held: `${named(relayed)} choose${one ? 's' : ''} ${facts.value}, and ${relayed[0]!.why}` };
  if (running.length === 0) {
    if (choosing !== undefined) parts.push(choosing);
    return {
      sureness: choosing === undefined ? 'no-consumer' : 'unsure',
      said: `no code that runs selects ${facts.value}: nothing that runs consumes ${channelName}${parts.length === 0 ? '' : `; ${parts.join('; ')}`}`,
      ...held,
    };
  }
  if (selecting.length > 0) parts.push(`${selecting.length} consumer${selecting.length === 1 ? '' : 's'} choose${selecting.length === 1 ? 's' : ''} other types (${named(selecting)})`);
  if (generic.length > 0) parts.push(`${named(generic)} pass${generic.length === 1 ? 'es' : ''} every type on without choosing, and what takes them past it is not read`);
  if (unread.length > 0) parts.push(`${named(unread)} not read (${unread[0]!.why})`);
  if (choosing !== undefined) parts.push(choosing);
  const sureness = generic.length === 0 && unread.length === 0 && choosing === undefined ? 'sure' : 'unsure';
  return { sureness, said: `no code that runs selects ${facts.value} on ${channelName}: ${parts.join('; ')}`, ...held };
};
