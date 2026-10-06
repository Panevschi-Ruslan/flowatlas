import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findItem } from './items-table';

/** GET /items/{itemId}. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const item = await findItem(event.pathParameters?.['itemId'] ?? '');
  return item === undefined ? { statusCode: 404, body: '{}' } : { statusCode: 200, body: JSON.stringify(item) };
};
