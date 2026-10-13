import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { queueReturn, type ReturnedItem } from '../lib/returns-queue';

/** POST /returns: deployed with RETURNS_QUEUE_URL set to the priority queue. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  await queueReturn(JSON.parse(event.body ?? '{}') as ReturnedItem);
  return { statusCode: 202, body: '' };
};
