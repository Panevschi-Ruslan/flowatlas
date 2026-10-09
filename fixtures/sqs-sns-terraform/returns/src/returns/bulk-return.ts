import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { queueReturn, type ReturnedItem } from '../lib/returns-queue';

/**
 * POST /returns/bulk: the same helper, from a function whose deployment does
 * not set RETURNS_QUEUE_URL - a row naming the function and the variable.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const items = JSON.parse(event.body ?? '[]') as ReturnedItem[];
  for (const item of items) await queueReturn(item);
  return { statusCode: 202, body: '' };
};
