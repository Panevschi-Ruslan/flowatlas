import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const documents = DynamoDBDocumentClient.from({ region: 'eu-west-1' });

export interface Order {
  orderId: string;
  customerId: string;
  items: string[];
  status: 'placed' | 'cancelled';
}

/**
 * POST /orders: writes the order to the orders table, whose stream runs
 * `order-changed`, and empties the cart, whose table has no stream. Notes it
 * in the `audit` table twice - a batch keyed by the bare word, and one keyed by
 * a shorthand property - and confirms it in a transaction that checks the cart
 * and writes the order: the check is no write.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const request = JSON.parse(event.body ?? '{}') as Pick<Order, 'customerId' | 'items'>;
  const order: Order = { ...request, orderId: `${request.customerId}-${Date.now()}`, status: 'placed' };
  const cart = await documents.send(new GetCommand({ TableName: process.env.CARTS_TABLE as string, Key: { customerId: order.customerId } }));
  await documents.send(new PutCommand({ TableName: process.env.ORDERS_TABLE as string, Item: { ...order, cart: cart.Item } }));
  await documents.send(
    new UpdateCommand({
      TableName: process.env.CARTS_TABLE as string,
      Key: { customerId: order.customerId },
      UpdateExpression: 'REMOVE items',
    }),
  );
  await documents.send(new BatchWriteCommand({ RequestItems: { audit: [{ PutRequest: { Item: { orderId: order.orderId, what: 'placed' } } }] } }));
  const audit = [{ PutRequest: { Item: { orderId: order.orderId, what: 'cart emptied' } } }];
  await documents.send(new BatchWriteCommand({ RequestItems: { audit } }));
  await documents.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: process.env.CARTS_TABLE as string,
            Key: { customerId: order.customerId },
            ConditionExpression: 'attribute_not_exists(items)',
          },
        },
        { Put: { TableName: process.env.ORDERS_TABLE as string, Item: { ...order, status: 'placed' } } },
      ],
    }),
  );
  return { statusCode: 201, body: JSON.stringify(order) };
};
