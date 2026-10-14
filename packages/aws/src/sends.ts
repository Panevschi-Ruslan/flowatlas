import { EVERY_KEY, type MessageTarget } from '@flowatlas/core';
import { DEFAULT_EVENT_BUS, type ChangesOf } from './channels.js';

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

/** One operation that writes to a table or puts a record on a stream (P51). */
export interface WriteOperation {
  /** The method a client calls it as. */
  readonly method: string;
  /** The command class version 3 of the SDK sends it as. */
  readonly command: string;
  /**
   * Where its input names the table or the stream, each path tried in order at
   * each element: a transaction names its table under the kind of write each
   * entry is. A step of `*` is every element of a list, and of `[key]` every
   * key of a record - a batch is keyed by the table it writes.
   */
  readonly address: readonly (readonly string[])[];
  /**
   * Where the input carries what is written, when it is one value: the item
   * put, or the key of the item changed or removed, which is what a reader of
   * the stream is handed of it either way.
   */
  readonly message?: readonly string[];
}

/** One client that writes, and what its writes land on. */
export interface WritingService {
  readonly changes: ChangesOf;
  readonly operations: readonly WriteOperation[];
}

/** The kinds of write a transaction's entries are, each naming its own table. */
const TRANSACTED = ['Put', 'Update', 'Delete'].map((write) => ['TransactItems', '*', write, 'TableName']);

/**
 * The SDK's operations that change a table or put a record on a stream (P51).
 *
 * A write to a table is a message only to whatever reads the table's stream,
 * so these are not sends: which of them reach anyone is the deployment's to
 * say, and the linker keeps a table write only where a stream of that table is
 * declared. Reads - `GetItem`, `Query`, `Scan` - are not rows, and never join.
 * The document client takes the same input under shorter names, and version 2
 * and `@aws-sdk/lib-dynamodb` call them alike.
 */
export const SDK_WRITES = {
  table: {
    changes: 'table',
    operations: [
      { method: 'putItem', command: 'PutItemCommand', address: [['TableName']], message: ['Item'] },
      { method: 'updateItem', command: 'UpdateItemCommand', address: [['TableName']], message: ['Key'] },
      { method: 'deleteItem', command: 'DeleteItemCommand', address: [['TableName']], message: ['Key'] },
      { method: 'batchWriteItem', command: 'BatchWriteItemCommand', address: [['RequestItems', EVERY_KEY]] },
      { method: 'transactWriteItems', command: 'TransactWriteItemsCommand', address: TRANSACTED },
    ],
  },
  document: {
    changes: 'table',
    operations: [
      { method: 'put', command: 'PutCommand', address: [['TableName']], message: ['Item'] },
      { method: 'update', command: 'UpdateCommand', address: [['TableName']], message: ['Key'] },
      { method: 'delete', command: 'DeleteCommand', address: [['TableName']], message: ['Key'] },
      { method: 'batchWrite', command: 'BatchWriteCommand', address: [['RequestItems', EVERY_KEY]] },
      { method: 'transactWrite', command: 'TransactWriteCommand', address: TRANSACTED },
    ],
  },
  stream: {
    changes: 'stream',
    operations: [
      { method: 'putRecord', command: 'PutRecordCommand', address: [['StreamName'], ['StreamARN']], message: ['Data'] },
      { method: 'putRecords', command: 'PutRecordsCommand', address: [['StreamName'], ['StreamARN']], message: ['Records', '*', 'Data'] },
    ],
  },
} as const satisfies Readonly<Record<string, WritingService>>;
