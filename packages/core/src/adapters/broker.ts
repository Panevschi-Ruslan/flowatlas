import type { NameLocator } from './locator.js';
import type { PackageJson } from './manifest.js';

/** What the transport calls the thing a message is addressed to. */
export type ChannelKind = 'topic' | 'queue' | 'exchange' | 'channel';

/** A call shape that publishes a message. */
export interface CallPattern {
  /** Method name on the receiver, e.g. `emit`. */
  method: string;
  /**
   * Shorthand for an address written as one plain argument: `channelArg: 0` says
   * exactly what `channel: [{ kind: 'argument', index: 0 }]` says, and `-1` says
   * that the address is not an argument at all and `channel` is where to look.
   *
   * Kept because it is how most patterns read and because a reader outside this
   * package reads it straight off a description; `channel` is what it expands to,
   * in one place, so the two cannot come to disagree.
   */
  channelArg: number;
  /**
   * Where the address is written, tried in order, first that yields a name wins.
   *
   * An index alone cannot reach the two shapes a large application actually
   * writes — the name as a property of an options object, and a receiver that
   * *is* the channel — and a description that cannot say where a name is has no
   * way to say it at all. Overrides `channelArg` when present.
   */
  channel?: readonly NameLocator[];
  /** Index of the argument holding the payload, when there is one. */
  payloadArg?: number;
  /**
   * Index of the argument naming the group a channel belongs to, for transports
   * that address a channel in two parts.
   */
  exchangeArg?: number;
  /** Index of the argument naming one unit of work, for transports that have them. */
  nameArg?: number;
  /**
   * Decorator on the constructor parameter that names the channel, for
   * transports where the receiver is bound to one channel rather than the call
   * naming it. Set `channelArg` to -1 in that case.
   */
  channelFromParameterDecorator?: string;
  /** Restricts the pattern to receivers of one of these declared types. */
  receiverType?: string | string[];
  /**
   * Restricts the pattern to receivers whose type is declared in one of these
   * packages, which is the only reliable way to tell a publish from any other
   * method that happens to share its name.
   */
  receiverPackages?: string[];
  /** Recorded on the producer node, e.g. `event`, `rpc`, `job`, `message`. */
  kind?: string;
}

export interface BrokerAdapter {
  name: string;
  detect(pkg: PackageJson): boolean;
  producerPatterns: CallPattern[];
  /** Decorator names that mark a method as receiving from a channel. */
  consumerDecorators: string[];
  channelKind: ChannelKind;
}
