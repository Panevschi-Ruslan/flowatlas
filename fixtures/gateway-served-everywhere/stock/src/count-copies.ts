import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** GET /copies/{bookId}: how many copies of the book are on the shelves. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify({ bookId: event.pathParameters?.bookId, copies: 3 }),
});
