import type { MessageTarget } from '@flowatlas/core';
import { DEFAULT_EVENT_BUS } from './channels.js';

/** One operation that sends: what it is called, and where its input carries the message. */
export interface SendOperation {
  /** The method a client calls it as, and the action a state machine's task names it by. */
  readonly method: string;
  /** The command class version 3 of the SDK sends it as. */
  readonly command: string;
  /** The list a batch carries its messages in, one entry each; absent for an operation that sends one. */
  readonly entries?: string;
  /** The field that carries the message: of the input, or of each entry of a batch. */
  readonly message: string;
}

/** How one service's input says where a message goes, and the operations that send one. */
export interface SendingService {
  /** The field that names the queue, the topic or the bus. */
  readonly address: string;
  /**
   * Where that field is: once on the input, for every message the call sends,
   * or on each entry, which then names its own destination.
   */
  readonly addressed: 'input' | 'entry';
  /** The destination an entry that leaves the field out goes to. */
  readonly absent?: string;
  /** The fields that name an event on its bus, beside the bus, read where the bus is. */
  readonly event?: { readonly source: string; readonly detailType: string };
  readonly operations: readonly SendOperation[];
}

/**
 * The SDK's operations that send a message to a queue, a topic or a bus, as
 * their input spells them (R176).
 *
 * Two readers meet these operations: code that calls the SDK, and a state
 * machine's task, whose integrations take the same input under the same action.
 * Each used to state the fields for itself, so a field added for one was a field
 * the other did not know; both read this table instead. A reader of every
 * service reads a row as a {@link SendingService}; one that reads a single
 * service is told exactly what its row holds.
 */
export const SDK_SENDS = {
  queue: {
    address: 'QueueUrl',
    addressed: 'input',
    operations: [
      { method: 'sendMessage', command: 'SendMessageCommand', message: 'MessageBody' },
      { method: 'sendMessageBatch', command: 'SendMessageBatchCommand', entries: 'Entries', message: 'MessageBody' },
    ],
  },
  topic: {
    address: 'TopicArn',
    addressed: 'input',
    operations: [
      { method: 'publish', command: 'PublishCommand', message: 'Message' },
      {
        method: 'publishBatch',
        command: 'PublishBatchCommand',
        entries: 'PublishBatchRequestEntries',
        message: 'Message',
      },
    ],
  },
  bus: {
    address: 'EventBusName',
    addressed: 'entry',
    absent: DEFAULT_EVENT_BUS,
    event: { source: 'Source', detailType: 'DetailType' },
    operations: [{ method: 'putEvents', command: 'PutEventsCommand', entries: 'Entries', message: 'Detail' }],
  },
} as const satisfies { readonly [K in MessageTarget['kind']]: SendingService };
