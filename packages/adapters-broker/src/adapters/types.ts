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

export interface BrokerSpec extends BrokerAdapter {
  consumerPatterns: ConsumerPattern[];
  subscriberPatterns?: SubscriberPattern[];
}
