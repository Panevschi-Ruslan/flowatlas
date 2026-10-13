import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { publishLibraryEvent } from '../lib/events';

export interface ReturnedItem {
  itemId: string;
  borrowerId: string;
  returnedAt: string;
}

/** POST /returns: published through the project's helper, which the configuration describes. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const item = JSON.parse(event.body ?? '{}') as ReturnedItem;
  await publishLibraryEvent('ItemReturned', item);
  return { statusCode: 202, body: '' };
};
