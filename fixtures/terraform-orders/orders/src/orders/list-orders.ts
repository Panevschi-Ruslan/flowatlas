import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const documents = DynamoDBDocumentClient.from({ region: 'eu-west-1' });

/** GET /orders on the HTTP API: a customer's orders. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const found = await documents.send(
    new QueryCommand({
      TableName: process.env.ORDERS_TABLE,
      KeyConditionExpression: 'customerId = :customer',
      ExpressionAttributeValues: { ':customer': event.queryStringParameters?.['customer'] },
    }),
  );
  return { statusCode: 200, body: JSON.stringify(found.Items ?? []) };
};
