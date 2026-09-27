import type { BrokerAdapter, NameLocator } from '@flowatlas/core';

export interface ConsumerPattern {
  /** Decorator that marks the method as receiving. */
  decorator: string;
  /**
   * Decorator on the class the channel is read from instead of the method's own.
   *
   * A worker class is bound to one channel and its methods handle units of work
   * within it, so the channel is stated once, above the class.
   */
  classDecorator?: string;
  /**
   * Where that decorator writes the channel, tried in order.
   *
   * The same vocabulary a publishing call is described with, because a decorator
   * is a call written with an `@` and a name in its options object is in the same
   * place whichever of the two wrote it. It is what replaced three fields that
   * each named one place — an argument, a key of an argument, the class's
   * decorator — with one list that can name all three and say which to try first.
   */
  channel: readonly NameLocator[];
  /** Argument naming one unit of work, when the transport has them. */
  nameArgIndex?: number;
  /**
   * Which of the handler's parameters the payload arrives in. The first by
   * default.
   *
   * A transport that hands a handler more than the message - the connection it
   * arrived on, the raw frame - passes them in a fixed order, and the message
   * is not always first.
   */
  payloadArg?: number;
  /**
   * A parameter decorator that marks the payload wherever it is written.
   *
   * Where a transport lets a handler name its parameters rather than order
   * them, the decorator is the statement and the position is an accident of how
   * the author wrote the list. Asked first, with `payloadArg` as the answer for
   * a handler that declares its parameters plainly.
   */
  payloadDecorator?: string;
  /**
   * Where the payload sits inside that parameter. Empty - the default - is the
   * whole of it.
   *
   * The receiving half of the same fact a publishing call states: a queue hands
   * its handler the library's envelope and the message is one property in, so a
   * handler taking the envelope on purpose is not a receiver missing every
   * field of the message (R133).
   */
  payloadPath?: readonly string[];
  kind: string;
}

/**
 * An adapter plus the shapes its consumers are written in.
 *
 * The published interface carries the decorator names; how each of those
 * decorators says which channel it listens to differs per transport, and that
 * detail belongs here rather than in the core.
 */
/**
 * A call that starts receiving, for transports where that is a call rather than
 * a decorator.
 */
export interface SubscriberPattern {
  /**
   * Method that begins listening, in every spelling a client of it is written
   * with.
   *
   * One verb is not one name. The same subscription is `psubscribe` in one
   * client of a transport and `pSubscribe` in the next major version of
   * another, and matching is exact, so a description holding one of the two
   * read the other as nothing at all - not as a degraded answer, as a channel
   * with one end, which joins nothing and says nothing about it (R135).
   *
   * So the spellings are stated here rather than known by the reader. A reader
   * that ignored case would be a rule nobody wrote down, applying to every
   * transport at once, including a bus a project wrote itself where `send` and
   * `Send` may well be two different methods; here the description says which
   * names mean the same call, and only the descriptions that need it pay for
   * it. A single name is the shorthand and reads exactly as it always did.
   */
  method: string | readonly string[];
  /** Shorthand for `channel: [{ kind: 'argument', index }]`, as on a publish. */
  channelArg: number;
  /** Where the channel is written, when it is not one plain argument. */
  channel?: readonly NameLocator[];
  /** Argument holding the handler, when the same call takes one. */
  handlerArg?: number;
  /** Method that registers a handler separately, e.g. an event listener. */
  listenerMethod?: string;
  /** Event name that listener is registered for. */
  listenerEvent?: string;
  /**
   * Restricts the pattern to receivers of one of these declared types, for a bus
   * a project wrote itself: there is no package to point at, so the type as
   * written at the call site is the only thing that tells this call apart from
   * any other method named `subscribe`.
   */
  receiverType?: string | string[];
  receiverPackages?: string[];
  kind: string;
}

/**
 * A part of the channel name that the class states rather than the call.
 *
 * A socket gateway declares a namespace once and every event in it is addressed
 * within that namespace, so `order:updated` on two namespaces is two channels
 * and not one. Without this they would collapse onto one node and join two
 * services that never speak — the failure the whole channel side is built to
 * avoid. It is written here rather than on the call pattern because it belongs
 * to the class: publishing and receiving in the same gateway share it.
 */
export interface ChannelPrefix {
  /** Decorator on the class that declares the endpoint. */
  classDecorator: string;
  /** Property of that decorator's options object holding the name. */
  optionKey: string;
  /** What goes between the prefix and the name the call writes. */
  separator: string;
}

export interface BrokerSpec extends BrokerAdapter {
  consumerPatterns: ConsumerPattern[];
  subscriberPatterns?: SubscriberPattern[];
  channelPrefix?: ChannelPrefix;
  /**
   * The kind a publishing call takes when it hands over somewhere to reply.
   *
   * Absent for a transport where publishing is always one-way. Where it is set,
   * the same method is a publish or a request depending on whether the call site
   * passes a callback, and the two are not the same thing on a graph.
   */
  acknowledgedKind?: string;
  /**
   * Names the transport keeps for itself.
   *
   * A socket signals `connect` and `disconnect` on the same channel mechanism it
   * carries application events on. Recording those as channels would fill the
   * graph with one node per repository that nobody publishes to and nothing can
   * be said about — the library talking to itself, drawn as architecture.
   */
  reservedChannels?: readonly string[];
}
