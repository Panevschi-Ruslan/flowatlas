import type { NameLocator } from './locator.js';
import type { FlowatlasConfig } from '../config.js';
import type { PackageJson } from './manifest.js';

/** What the transport calls the thing a message is addressed to. */
export type ChannelKind = 'topic' | 'queue' | 'exchange' | 'channel';

/**
 * One part of an address written in several.
 *
 * Most transports address a message with one name. Some address it with
 * several that only together say where it goes - a bus, a source within it and
 * a kind of event from that source - and a channel named by one of them alone
 * would join publishers that never meet. So an address is a list of parts,
 * joined with `/` into the channel's name, and each part is either a word the
 * description states or a place in the call where the code writes it.
 */
export type AddressPart =
  /** A word every address of the pattern starts with, whatever the call says. */
  | { readonly literal: string }
  | {
      /** Where the part is written, tried in order, as for `channel`. */
      readonly at: readonly NameLocator[];
      /**
       * What the part is when the call writes nothing there.
       *
       * A library that fills in a value when it is left out has still been told
       * where to send the message, and the address it reaches is that value's.
       * Only for nothing written: a value that is written and cannot be read is
       * never replaced by this, because that would be a guess.
       */
      readonly absent?: string;
      /**
       * Longer spellings the name may be written inside, each a regular
       * expression whose first group is the name.
       *
       * The same thing is often addressed by a locator of its own - a URL, an
       * identifier carrying its owner and region - and both ends of a channel
       * have to arrive at one name however each of them spelled it. A value no
       * expression matches is the name as written.
       */
      readonly forms?: readonly string[];
    };

/** A call shape that publishes a message. */
export interface CallPattern {
  /** Method name on the receiver, e.g. `emit`; or the function's name, for a function. */
  method: string;
  /**
   * How the call is written: on a receiver, `bus.publish(…)`, which is the
   * default; or as a function of the project's own called by its name,
   * `publish(…)`, which has no receiver to name and is told apart by the name
   * it is declared with.
   */
  calledAs?: 'method' | 'function';
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
  /**
   * The address in parts, for a transport that names a message with more than
   * one word. Overrides `channel`, which is the one-part address written short.
   *
   * A locator that walks a list (`*`) makes one address per element, and every
   * part walking the same list is read at the same element.
   */
  address?: readonly AddressPart[];
  /**
   * Where the message itself is written, as an expression, tried in order.
   * Overrides `payloadArg`.
   *
   * For a call whose message is a property of its input rather than an argument
   * of its own, and one per element where the address walks a list. A message
   * sent as `JSON.stringify(value)` is read as the value, because that is what
   * the receiver parses back out.
   */
  payload?: readonly NameLocator[];
  /** Index of the argument holding the payload, when there is one. */
  payloadArg?: number;
  /**
   * Where the payload sits inside that argument, when the argument is a wrapper
   * around it. Empty - the default - is the whole of it.
   *
   * A transport is often handed a record that carries the message rather than
   * the message itself: a name, a set of options and the payload one property
   * in. Which of the two `payloadArg` points at differs per transport, and
   * until a description could say which, it said neither: one end of a channel
   * was compared as though the wrapper were the message, and the handler that
   * declares the message was told it required fields nobody sends. A row that
   * said too little became a row that said something false about somebody's
   * code, which is worse (R133).
   *
   * Properties, in order, from the argument inwards. A path that does not fit
   * the value leaves the payload unknown rather than falling back to the
   * wrapper, because the wrapper is the answer this exists to stop giving.
   */
  payloadPath?: readonly string[];
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
  /**
   * Whether the repository uses the transport.
   *
   * `repoDir` is offered for a transport whose package may be declared by a
   * manifest below the repository's own - a repository of functions that keeps
   * a manifest per function - and offered rather than promised: a caller with
   * no directory to hand passes none, and the manifest answers alone.
   */
  detect(pkg: PackageJson, config?: FlowatlasConfig, repoDir?: string): boolean;
  producerPatterns: CallPattern[];
  /** Decorator names that mark a method as receiving from a channel. */
  consumerDecorators: string[];
  channelKind: ChannelKind;
}
