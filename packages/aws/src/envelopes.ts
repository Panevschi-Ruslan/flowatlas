import { ELEMENT, type DeployedDelivery, type DeployedEntryKind, type Envelope } from '@flowatlas/core';

/**
 * Where a message sits in what each kind of delivery hands a function (R172).
 *
 * The shapes `@types/aws-lambda` declares for each event: a queue's message is
 * the text of `Records[].body` (`SQSEvent`), a topic's the text of
 * `Records[].Sns.Message` (`SNSEvent`), a bus's the value of `detail`
 * (`EventBridgeEvent<T, D>`). A function invoked, or a workflow started, is
 * handed the input itself.
 */
export const ENVELOPES = {
  queue: { at: ['Records', ELEMENT, 'body'], text: true },
  topic: { at: ['Records', ELEMENT, 'Sns', 'Message'], text: true },
  bus: { at: ['detail'], text: false },
  invoke: { at: [], text: false },
  start: { at: [], text: false },
} as const satisfies Readonly<Record<string, Envelope>>;

export type DeliveryEnvelope = keyof typeof ENVELOPES;

/** What a call that starts something by its deployed name hands it, by what it starts. */
export const STARTED: Readonly<Record<DeployedEntryKind, Envelope>> = {
  invoke: ENVELOPES.invoke,
  workflow: ENVELOPES.start,
};

/** The input as it was sent, when nothing wraps it. */
const AS_SENT: Envelope = { at: [], text: false };

/**
 * What a delivery hands on when its target is another channel rather than code.
 *
 * A rule sending to a queue or a topic sends the whole event, the message at
 * `detail`; a subscription sending to a queue sends the notification, the
 * message as text at `Message`, unless it delivers raw. The keys beside the
 * message are what the service writes there, so a reader further on that
 * expects one of them is not told it is missing.
 */
export const ONWARD: Readonly<Partial<Record<DeliveryEnvelope, Envelope>>> = {
  bus: {
    at: ['detail'],
    text: false,
    beside: ['version', 'id', 'detail-type', 'source', 'account', 'time', 'region', 'resources'],
  },
  topic: {
    at: ['Message'],
    text: true,
    beside: [
      'Type',
      'MessageId',
      'TopicArn',
      'Subject',
      'Timestamp',
      'SignatureVersion',
      'Signature',
      'SigningCertURL',
      'UnsubscribeURL',
      'MessageAttributes',
    ],
  },
};

const isChannel = (kind: string): boolean => kind === 'queue' || kind === 'topic' || kind === 'bus';

/**
 * How a delivery a deployment declares wraps what it hands its target, or
 * nothing where that is not known: a target whose input is rewritten
 * (`input_transformer`, `input_path`, `input`), or a pipe, whose target is
 * handed a batch shaped by the pipe.
 *
 * A rule that targets another bus puts the same event on it, its message still
 * at `detail`, where that bus's rules hand it on as they would any event: the
 * message is forwarded as it was sent (R174).
 */
export const deliveryEnvelope = (delivery: DeployedDelivery): Envelope | undefined => {
  const { from, to } = delivery;
  if (to === undefined || delivery.by === 'pipe' || delivery.meta?.['transformed'] === true) return undefined;
  if (from.kind !== 'queue' && from.kind !== 'topic' && from.kind !== 'bus') return undefined;
  if (!isChannel(to.kind)) return ENVELOPES[from.kind];
  if (from.kind === 'bus' && to.kind === 'bus') return AS_SENT;
  return delivery.meta?.['raw'] === true ? AS_SENT : ONWARD[from.kind];
};
