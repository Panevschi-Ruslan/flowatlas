import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ORDERS_SOURCE, type Order } from '../lib/orders';

const documents = DynamoDBDocumentClient.from({ region: 'eu-west-1' });
const events = new EventBridgeClient({ region: 'eu-west-1' });
const sqs = new SQSClient({ region: 'eu-west-1' });

/**
 * POST /orders: writes the order to the orders table, whose stream runs
 * `order-changed`, queues it for `ship-order`, and says on the bus that it was
 * placed, which starts the shipping workflow.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const request = JSON.parse(event.body ?? '{}') as Pick<Order, 'customerId' | 'items'>;
  const order: Order = { ...request, orderId: `${request.customerId}-${Date.now()}`, status: 'placed' };
  await documents.send(new PutCommand({ TableName: process.env.ORDERS_TABLE, Item: order }));
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.ORDERS_QUEUE_URL, MessageBody: JSON.stringify(order) }));
  await events.send(
    new PutEventsCommand({
      Entries: [{ EventBusName: process.env.ORDERS_BUS_NAME, Source: ORDERS_SOURCE, DetailType: 'OrderPlaced', Detail: JSON.stringify(order) }],
    }),
  );
  return { statusCode: 201, body: JSON.stringify(order) };
};
