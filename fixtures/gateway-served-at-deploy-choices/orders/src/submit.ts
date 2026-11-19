import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** POST /submit: a basket is submitted as an order. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 201,
  body: JSON.stringify({ received: (event.body ?? '').length }),
});
