import type { GraphNode } from './model/nodes.js';

/**
 * The kinds of message one channel carries, told apart by a string field
 * (P358).
 *
 * One channel often carries many kinds of message - `{ type: 'ORDER_READY' }`,
 * `{ type: 'COURIER_ASSIGNED' }` - and one consumer takes them all, choosing
 * what to do by the field. Such a type is a channel of its own as far as a
 * question about it goes: something publishes it, something selects it, and
 * nothing may select it at all. So it is drawn as one: a `channel` node of
 * kind `message_type`, keyed by its channel and its value, which every
 * publish of that type `emits` to and every handler that selects it
 * `consumes` from. Nothing new in the model: a walk, `dead` and `impact` that
 * already know a channel know a type.
 *
 * The parent channel keeps its own edges as they were, so a question about the
 * channel answers as it always did; the type nodes sit beside it, and say which
 * channel they belong to in `meta.channel`.
 */

/** The `kind` of a channel node that is one type of message on another channel. */
export const MESSAGE_TYPE_KIND = 'message_type';

/**
 * The fields a message's type is read from, in the order a payload is asked.
 *
 * `type` is the default and by far the most common; the others are read where
 * the payload has no `type`, or where a consumer chooses on one of them.
 */
export const DISCRIMINATOR_FIELDS = ['type', 'kind', 'eventType', 'event'] as const;

export type DiscriminatorField = (typeof DISCRIMINATOR_FIELDS)[number];

export const isDiscriminatorField = (name: string): name is DiscriminatorField =>
  (DISCRIMINATOR_FIELDS as readonly string[]).includes(name);

/** The separator between a channel's id and a type's value in a type node's id. */
const TYPE_SEPARATOR = '#';

/**
 * `channel:<name>#<value>`: one type of message on one channel.
 *
 * Under the channel's own id rather than beside it, so that the producer of a
 * type and its handler in two repositories land on one node exactly as the two
 * ends of the channel do, and so that every reader of a channel id reads it.
 */
export const makeMessageTypeId = (channelId: string, value: string): string => `${channelId}${TYPE_SEPARATOR}${value}`;

/** Whether a node is a type of message on a channel rather than a channel. */
export const isMessageTypeNode = (node: Pick<GraphNode, 'type' | 'kind'> | undefined): boolean =>
  node?.type === 'channel' && node.kind === MESSAGE_TYPE_KIND;

/**
 * What a producer records about the types it sends (P358), on its node's meta.
 *
 * `messageTypes` the values read, `discriminator` the field they were read
 * from; `messageTypeUnread` why a payload that has a type had it not read.
 */
export const MESSAGE_TYPES_META = 'messageTypes';
export const DISCRIMINATOR_META = 'discriminator';
export const MESSAGE_TYPE_UNREAD_META = 'messageTypeUnread';

/**
 * What a consumer records about the types it selects (P358), on its node's
 * meta: one entry per type and the consumer that handles it.
 */
export const SELECTS_META = 'selects';
/** Why a consumer that reads the type had its selection not read. */
export const SELECTION_UNREAD_META = 'selectionUnread';
/** A consumer that selects some types and hands every other one on, the same way. */
export const SELECTS_OTHERS_META = 'selectsOthers';
/**
 * On a consumer whose types two sources say differently (P397): the code
 * calling its handler under a choice says one set, the declared type of the
 * parameter it is handed the message in another. The caller's choice is drawn;
 * this says why a comparison resting on it is not sure.
 */
export const SELECTION_DIFFERS_META = 'selectionDiffers';
/** On a consumer drawn for a selection: the consumer whose handler selected it. */
export const SELECTED_BY_META = 'selectedBy';

/**
 * How a selection was written. `parameter` (P369): the handler chooses nothing
 * in its body, and the declared type of the parameter it is handed the message
 * in has a discriminator whose type is a literal - `handle(event:
 * OrderReady)` where `OrderReady` says `type: 'ORDER_READY'`.
 */
export type SelectionVia = 'switch' | 'if' | 'guard' | 'map' | 'decorator' | 'filter' | 'parameter';

/**
 * On a consumer that subscribes to every channel of a bus at once (P369) - a
 * call on the bus that names no channel, its answer subscribed, such as
 * `bus.all().subscribe(…)`: the name of the bus's description, whose channels
 * the linker joins it to, every channel a publish through that bus in the same
 * service writes to.
 */
export const EVERY_CHANNEL_META = 'everyChannelOf';

/** One type a consumer selects, and the consumer that handles it. */
export interface Selection {
  /** The value of the discriminator. */
  readonly type: string;
  /** The consumer node handling it: the one drawn for the handler the branch runs, or the dispatcher's own. */
  readonly consumer: string;
  readonly via: SelectionVia;
  readonly line: number;
  /** The file the choice is written in, where it is not the consumer's own. */
  readonly file?: string;
  /** A selection resting on what a name suggests rather than on the code: a decorator nothing calls by. */
  readonly heuristic?: true;
}

/** The selections a consumer node records, as written; malformed entries are dropped. */
export const selectionsOf = (node: Pick<GraphNode, 'meta'> | undefined): Selection[] => {
  const raw = node?.meta?.[SELECTS_META];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Selection =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Selection).type === 'string' &&
      typeof (entry as Selection).consumer === 'string',
  );
};

/** The types a producer records, as written. */
export const messageTypesOf = (node: Pick<GraphNode, 'meta'> | undefined): string[] => {
  const raw = node?.meta?.[MESSAGE_TYPES_META];
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
};
