import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** One segment, which a request of exactly that shape reaches before the catch-all. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify({ id: event.pathParameters?.id }),
});
