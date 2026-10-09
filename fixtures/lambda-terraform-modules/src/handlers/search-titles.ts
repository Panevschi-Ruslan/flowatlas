import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { searchTitles } from '../lib/catalogue';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const found = await searchTitles(event.queryStringParameters?.q ?? '');
  return { statusCode: 200, body: JSON.stringify(found) };
};
