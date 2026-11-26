import type { APIGatewayProxyWebsocketEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** The live orders socket: run when a client connects, and for each `subscribe` message it sends. */
export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => {
  console.log(event.requestContext.routeKey, event.requestContext.connectionId);
  return { statusCode: 200, body: '' };
};
