import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** POST /members on the HTTP API: a new member. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => ({ statusCode: 201, body: event.body ?? '{}' });
