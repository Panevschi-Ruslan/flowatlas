import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** GET /products/{id}, on the HTTP API. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify({ id: event.pathParameters?.['id'] }),
});
