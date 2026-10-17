import { InvokeCommand } from '@aws-sdk/client-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import { documents, functions, payloadOf, type Order } from '../lib/clients';

/** Run by the `order-placed` queue: reads the order back and has its label printed. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const placed = JSON.parse(record.body) as Order;
    const found = await documents.send(new GetCommand({ TableName: process.env.ORDERS_TABLE as string, Key: { orderId: placed.orderId } }));
    await functions.send(new InvokeCommand({ FunctionName: 'print-label', Payload: payloadOf(found.Item ?? placed) }));
  }
};
