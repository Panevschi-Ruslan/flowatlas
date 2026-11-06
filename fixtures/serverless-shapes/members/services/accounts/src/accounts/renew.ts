import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** PUT /members/{id}/renewal on the HTTP API. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => ({
  statusCode: 200,
  body: JSON.stringify({ renewed: event.pathParameters?.['id'] }),
});
