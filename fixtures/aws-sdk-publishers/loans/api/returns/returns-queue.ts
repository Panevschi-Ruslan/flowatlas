import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

export interface ReturnedItem {
  itemId: string;
  loanId: string;
  returnedAt: string;
  condition: 'good' | 'damaged';
}

const sqs = new SQSClient({ region: 'eu-west-1' });

/** The queue a returned item waits in to be shelved, by its URL. */
const RETURNS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/111122223333/library-returns';

export const queueReturn = async (item: ReturnedItem): Promise<void> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: RETURNS_QUEUE_URL, MessageBody: JSON.stringify(item) }));
};

/**
 * A batch to the same queue. The entries are built at run time, so what each
 * carries is not written here; where it goes is.
 */
export const queueReturns = async (items: ReturnedItem[]): Promise<void> => {
  await sqs.send(
    new SendMessageBatchCommand({
      QueueUrl: RETURNS_QUEUE_URL,
      Entries: items.map((item, index) => ({ Id: String(index), MessageBody: JSON.stringify(item) })),
    }),
  );
};

/** A queue named by the deployment: the variable is all the code says. */
export const queueOverdue = async (item: ReturnedItem): Promise<void> => {
  await sqs.send(
    new SendMessageCommand({ QueueUrl: process.env.OVERDUE_QUEUE_URL, MessageBody: JSON.stringify(item) }),
  );
};

/** Receiving and deleting go through the same `send`, and publish nothing. */
export const drainReturns = async (): Promise<number> => {
  const received = await sqs.send(new ReceiveMessageCommand({ QueueUrl: RETURNS_QUEUE_URL, MaxNumberOfMessages: 10 }));
  for (const message of received.Messages ?? []) {
    await sqs.send(new DeleteMessageCommand({ QueueUrl: RETURNS_QUEUE_URL, ReceiptHandle: message.ReceiptHandle }));
  }
  return received.Messages?.length ?? 0;
};
