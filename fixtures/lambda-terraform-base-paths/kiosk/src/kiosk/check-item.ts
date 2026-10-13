import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * The kiosk asks the catalogue about an item, at the address the library's
 * domain publishes: the catalogue API is mapped at `v1`.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const itemId = event.pathParameters?.['itemId'] ?? '';
  const response = await fetch(`${process.env.LIBRARY_API_URL}/v1/items/${itemId}`);
  return { statusCode: response.status, body: await response.text() };
};
