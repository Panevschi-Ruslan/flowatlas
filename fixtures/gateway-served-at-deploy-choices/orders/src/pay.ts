import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** POST /payments: an order is paid for. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => ({
  statusCode: 201,
  body: JSON.stringify({ received: (event.body ?? '').length }),
});
