import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

/** `$default`: any message whose `action` no route names. */
export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => ({
  statusCode: 400,
  body: JSON.stringify({ message: `no route for ${event.requestContext.routeKey}` }),
});
