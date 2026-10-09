import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { queueReturn, type ReturnedItem } from '../lib/returns-queue';

/** POST /returns/bulk: deployed without RETURNS_QUEUE_URL, so on the default queue. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const items = JSON.parse(event.body ?? '[]') as ReturnedItem[];
  for (const item of items) await queueReturn(item);
  return { statusCode: 202, body: '' };
};
