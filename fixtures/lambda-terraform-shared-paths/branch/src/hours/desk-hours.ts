import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** GET /hours of the lending desk's API, whose name is not read. */
export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => ({
  statusCode: 200,
  body: JSON.stringify({ desk: 'lending', opens: '09:00' }),
});
