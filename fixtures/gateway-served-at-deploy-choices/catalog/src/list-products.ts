import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** GET /products: the products on sale. */
export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify({ products: [] }),
});
