import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { saveItem, type Item } from './items-table';

/** POST /items, through the local module written as JSON. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const item = JSON.parse(event.body ?? '{}') as Item;
  await saveItem(item);
  return { statusCode: 201, body: JSON.stringify(item) };
};
