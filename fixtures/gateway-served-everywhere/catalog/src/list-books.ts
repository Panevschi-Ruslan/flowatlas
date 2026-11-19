import type { APIGatewayProxyResult } from 'aws-lambda';

/** GET /books: the books on the shelves. */
export const handler = async (): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify([{ bookId: 'b-1', title: 'A Field Guide to Ferns' }]),
});
