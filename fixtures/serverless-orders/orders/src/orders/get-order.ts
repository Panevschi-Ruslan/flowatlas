import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const documents = DynamoDBDocumentClient.from({ region: 'eu-west-1' });

/** GET /orders/{id}: one order, read from the table. A read fires nothing. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const found = await documents.send(new GetCommand({ TableName: process.env.ORDERS_TABLE, Key: { orderId: event.pathParameters?.['id'] } }));
  return found.Item === undefined ? { statusCode: 404, body: '' } : { statusCode: 200, body: JSON.stringify(found.Item) };
};
