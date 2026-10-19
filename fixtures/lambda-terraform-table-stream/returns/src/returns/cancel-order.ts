import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({ region: 'eu-west-1' });

/**
 * POST /orders/{orderId}/cancel: marks the order cancelled in the shop's
 * table, named here as the shop deploys it. The shop's stream runs
 * `order-changed` on the change.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orderId = event.pathParameters?.['orderId'] ?? '';
  await client.send(
    new UpdateItemCommand({
      TableName: 'shop-orders',
      Key: { orderId: { S: orderId } },
      UpdateExpression: 'SET #status = :cancelled',
      ExpressionAttributeValues: { ':cancelled': { S: 'cancelled' } },
    }),
  );
  return { statusCode: 204, body: '' };
};
