import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { cancelHold } from '../src/holds/holds-table';
import { json } from './shared/request';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const cancelled = await cancelHold(event.pathParameters?.holdId ?? '');
  return cancelled === undefined ? json(404, { message: 'no such hold' }) : json(200, cancelled);
};
