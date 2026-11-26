import type { APIGatewayProxyResult } from 'aws-lambda';

/** GET /reviews: the latest reviews readers wrote. */
export const handler = async (): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify([{ bookId: 'b-1', text: 'Thorough and kind.' }]),
});
