import {
  HANDS_ON_META,
  isMessageTypeNode,
  MESSAGE_TYPE_UNREAD_META,
  SELECTION_UNREAD_META,
  selectionsOf,
  UNREACHED_META,
  type GraphEdge,
  type GraphNode,
} from '@flowatlas/core';

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
}

/** The class a method's id names, by id: `<repo>#<file>:<Class>.<method>` gives `<repo>#<file>:<Class>`. */
const classIdOf = (symbol: string): string | undefined => {
  const cut = symbol.lastIndexOf(':');
  const dot = symbol.lastIndexOf('.');
  return cut < 0 || dot < cut ? undefined : symbol.slice(0, dot);
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
  return { type, channel, value, producers, selectors, receivers, unreadProducers };
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
  if (running.length === 0) {
    return { sureness: 'no-consumer', said: `no code that runs selects ${facts.value}: nothing that runs consumes ${channelName}${parts.length === 0 ? '' : `; ${parts.join('; ')}`}` };
  }
  if (selecting.length > 0) parts.push(`${selecting.length} consumer${selecting.length === 1 ? '' : 's'} choose${selecting.length === 1 ? 's' : ''} other types (${named(selecting)})`);
  if (generic.length > 0) parts.push(`${named(generic)} pass${generic.length === 1 ? 'es' : ''} every type on without choosing, and what takes them past it is not read`);
  if (unread.length > 0) parts.push(`${named(unread)} not read (${unread[0]!.why})`);
  const sureness = generic.length === 0 && unread.length === 0 ? 'sure' : 'unsure';
  return { sureness, said: `no code that runs selects ${facts.value} on ${channelName}: ${parts.join('; ')}` };
};
