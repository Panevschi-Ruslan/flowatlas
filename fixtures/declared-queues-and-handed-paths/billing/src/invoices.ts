import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** GET /invoices: the invoices of the shop. */
export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => ({
  statusCode: 200,
  body: JSON.stringify([]),
});
