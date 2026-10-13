import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const items = new Map<string, { title: string }>([['b-1', { title: 'The Name of the Rose' }]]);

/** GET /items/{itemId} of the kiosk API, whose document is built in place with jsonencode(). */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const item = items.get(event.pathParameters?.['itemId'] ?? '');
  return item === undefined ? { statusCode: 404, body: '{}' } : { statusCode: 200, body: JSON.stringify(item) };
};
