import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchWriteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import AWS from 'aws-sdk';

const client = new DynamoDBClient({ region: 'eu-west-1' });
const legacy = new AWS.DynamoDB.DocumentClient({ region: 'eu-west-1' });

/**
 * POST /orders/clear: removes a customer's returned orders in one batch, keyed
 * by the table this function is deployed with, and the customer's own record
 * with version 2 of the SDK.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { customerId, orderIds } = JSON.parse(event.body ?? '{}') as { customerId: string; orderIds: string[] };
  await client.send(
    new BatchWriteItemCommand({
      RequestItems: {
        [process.env.ORDERS_TABLE as string]: orderIds.map((orderId) => ({ DeleteRequest: { Key: { orderId: { S: orderId } } } })),
      },
    }),
  );
  await legacy.delete({ TableName: 'shop-orders', Key: { orderId: `${customerId}-latest` } }).promise();
  return { statusCode: 204, body: '' };
};
