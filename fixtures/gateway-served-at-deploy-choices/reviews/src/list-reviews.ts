import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** GET /reviews: what shoppers say. */
export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify({ reviews: [] }),
});
