import type { BrokerAdapter } from '@flowatlas/core';

/** Where the channel a handler receives from is written. */
export type ConsumerChannelSource = 'argument' | 'option' | 'class-decorator';

export interface ConsumerPattern {
  /** Decorator that marks the method as receiving. */
  decorator: string;
  channelFrom: ConsumerChannelSource;
  /** Argument holding the channel, for `argument`. */
  argIndex?: number;
  /** Property of the options object holding the channel, for `option`. */
  optionKey?: string;
  /** Decorator on the class that names the channel, for `class-decorator`. */
  classDecorator?: string;
  /** Argument naming one unit of work, when the transport has them. */
  nameArgIndex?: number;
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
  /** Method that begins listening. */
  method: string;
  /** Argument naming the channel. */
  channelArg: number;
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
  /**
   * Whether the publishing method's own declaration says nothing useful.
   *
   * A bus typed for its own catalogue declares what it carries, and that
   * declaration beats any one call's argument. A socket does not: its `emit` is
   * `(event: string, ...args: any[])`, so reading the declaration back gives the
   * rest parameter's array and hides the only shape anybody wrote down. Where
   * this is set the argument at the call site is the answer, because it is the
   * only answer there is.
   */
  payloadFromCallSite?: boolean;
}
