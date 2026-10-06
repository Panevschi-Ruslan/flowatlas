import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { placeHold } from '../src/holds/holds-table';
import { titleExists } from './shared/catalogue';
import { json, readHoldRequest } from './shared/request';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { isbn, borrowerId } = readHoldRequest(event);
  if (!(await titleExists(isbn))) return json(404, { message: 'no such title' });
  const hold = await placeHold(isbn, borrowerId);
  return json(201, hold);
};
