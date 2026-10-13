import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findTitle } from '../lib/catalogue';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const title = await findTitle(event.pathParameters?.isbn ?? '');
  return { statusCode: title === undefined ? 404 : 200, body: JSON.stringify(title ?? {}) };
};
