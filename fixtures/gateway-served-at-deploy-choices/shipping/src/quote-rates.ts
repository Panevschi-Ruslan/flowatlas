import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** GET /rates: what shipping a basket costs. */
export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify({ rates: [] }),
});
