import {
  ADDRESS_SEPARATOR,
  type ChannelKind,
  type ChannelPattern,
  type MessagePattern,
  type MessageTarget,
} from '@flowatlas/core';

/**
 * How a channel of each service is named.
 *
 * The grammar every end of a channel has to agree on, stated once: a publisher
 * read from code arrives at it through the SDK's descriptions, a step of a state
 * machine that sends a message arrives at it through its definition, and a
 * subscriber read from a deployment arrives at it through these functions, so
 * all of them land on one node. Each name starts with its service, because a
 * queue and a topic are often given the same name and are not the same channel.
 *
 * - a queue is `sqs/<queue name>`;
 * - a topic is `sns/<topic name>`;
 * - an event is `eventbridge/<bus>/<source>/<detail type>`, and the bus an
 *   entry leaves out is the one the service calls `default`, written out.
 *
 * Names are the deployed names, never a URL or an ARN: those are read through
 * `DEPLOYED_FORMS` to the name inside them, which is what a deployment names the
 * same resource by.
 */
export const AWS_SERVICE_PREFIX = { sqs: 'sqs', sns: 'sns', eventbridge: 'eventbridge' } as const;

/** The bus an event goes to when its entry names none. */
export const DEFAULT_EVENT_BUS = 'default';

export const queueChannel = (name: string): string => [AWS_SERVICE_PREFIX.sqs, name].join(ADDRESS_SEPARATOR);

export const topicChannel = (name: string): string => [AWS_SERVICE_PREFIX.sns, name].join(ADDRESS_SEPARATOR);

export const eventChannel = (bus: string | undefined, source: string, detailType: string): string =>
  [AWS_SERVICE_PREFIX.eventbridge, bus ?? DEFAULT_EVENT_BUS, source, detailType].join(ADDRESS_SEPARATOR);

/**
 * The two fields of an event its channel is named by, as an event pattern
 * spells them. Every other field a pattern filters on - `detail`, `account`,
 * `resources` - is recorded and not matched on (P23).
 */
export const EVENT_NAME_FIELDS = ['source', 'detail-type'] as const;

/**
 * The channel a message sent to a deployed target lands on, in the grammar
 * above; `undefined` for an event whose fields do not name one exactly.
 */
export const channelOfTarget = (target: MessageTarget): string | undefined => {
  switch (target.kind) {
    case 'queue':
      return queueChannel(target.name);
    case 'topic':
      return topicChannel(target.name);
    case 'bus': {
      const [source, detailType] = EVENT_NAME_FIELDS.map((field) => target.fields?.[field]);
      return source === undefined || detailType === undefined ? undefined : eventChannel(target.name, source, detailType);
    }
  }
};

/**
 * Events on a bus that a pattern selects, as a pattern over channel names.
 *
 * The parts are the grammar's: the service, the bus, the source, the detail
 * type. A field the pattern does not filter matches any value.
 */
export const eventChannelPattern = (bus: string, pattern: MessagePattern): ChannelPattern => ({
  parts: [
    { name: 'service', filters: [{ equals: AWS_SERVICE_PREFIX.eventbridge }] },
    { name: 'bus', filters: [{ equals: bus }] },
    ...EVENT_NAME_FIELDS.map((field) => ({ name: field, filters: pattern.fields[field] ?? [] })),
  ],
});

/**
 * The adapter, the kind of channel and the kind of message a queue, a topic or
 * a bus is read as, whoever reads it: the SDK's publishers, a deployment's
 * subscribers, a step that sends.
 */
// Many rules may match one event, and nothing queues it for them: a bus is a topic.
export const DEPLOYED_CHANNELS: Readonly<
  Record<MessageTarget['kind'], { adapter: string; channelKind: ChannelKind; kind: 'message' | 'event' }>
> = {
  queue: { adapter: 'aws-sqs', channelKind: 'queue', kind: 'message' },
  topic: { adapter: 'aws-sns', channelKind: 'topic', kind: 'message' },
  bus: { adapter: 'aws-eventbridge', channelKind: 'topic', kind: 'event' },
};
