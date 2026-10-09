import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

export const sqs = new SQSClient({ region: 'eu-west-1' });

export interface ReturnedItem {
  itemId: string;
  borrowerId: string;
  branchId: string;
  returnedAt: string;
}

/**
 * Queues a return to be processed: on the queue RETURNS_QUEUE_URL names where
 * the function running this is deployed with it, and on the library's returns
 * queue otherwise.
 */
export const queueReturn = async (item: ReturnedItem): Promise<void> => {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.RETURNS_QUEUE_URL ?? 'https://sqs.eu-west-1.amazonaws.com/123456789012/library-returns',
      MessageBody: JSON.stringify(item),
    }),
  );
};
