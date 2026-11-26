import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ORDERS_SOURCE } from '../lib/orders';

const events = new EventBridgeClient({ region: 'eu-west-1' });

/** DELETE /orders/{id}: says on the bus that the order was cancelled; `refund-order` takes it from there. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const orderId = event.pathParameters?.['id'] ?? '';
  await events.send(
    new PutEventsCommand({
      Entries: [{ EventBusName: process.env.ORDERS_BUS_NAME, Source: ORDERS_SOURCE, DetailType: 'OrderCancelled', Detail: JSON.stringify({ orderId }) }],
    }),
  );
  return { statusCode: 202, body: '' };
};
