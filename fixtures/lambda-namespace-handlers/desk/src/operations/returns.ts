import type { APIGatewayProxyEvent, APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { json } from '../lib/http';
import { sqs } from '../lib/queues';

export interface ReturnedItem {
  itemId: string;
  borrowerId: string;
  returnedAt: string;
}

/** POST /returns: queues the return for processing. */
export const recordReturn = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const item = JSON.parse(event.body ?? '{}') as ReturnedItem;
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.RETURNS_QUEUE_URL,
      MessageBody: JSON.stringify(item),
    }),
  );
  return json(202, item);
};

/** Reads the returns queue, one record per returned item. */
export const processReturns = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const item = JSON.parse(record.body) as ReturnedItem;
    console.log(`returned ${item.itemId}`);
  }
};
