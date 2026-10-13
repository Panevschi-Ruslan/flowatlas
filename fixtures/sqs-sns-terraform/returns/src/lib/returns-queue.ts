import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

export const sqs = new SQSClient({ region: 'eu-west-1' });

export interface ReturnedItem {
  itemId: string;
  borrowerId: string;
  branchId: string;
  returnedAt: string;
}

/**
 * Queues a return to be processed. Which queue is the value of
 * RETURNS_QUEUE_URL, set where the function that calls this is deployed.
 */
export const queueReturn = async (item: ReturnedItem): Promise<void> => {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.RETURNS_QUEUE_URL,
      MessageBody: JSON.stringify(item),
    }),
  );
};
