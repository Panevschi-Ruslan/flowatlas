import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { removeHold } from '../lib/holds-table';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const removed = await removeHold(event.pathParameters?.holdId ?? '');
  return { statusCode: removed ? 204 : 404, body: '' };
};
