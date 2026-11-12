import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** POST /orders: queues the order on the platform's queue. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const order = { ...(JSON.parse(event.body ?? '{}') as { sku: string; quantity: number }), placedAt: Date.now() };
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.PLACED_QUEUE_URL, MessageBody: JSON.stringify(order) }));
  return { statusCode: 201, body: JSON.stringify(order) };
};
