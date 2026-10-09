import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { remember } from './connections-table';

/** `$connect`: a borrower opens the reading room. */
export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => {
  await remember(event.requestContext.connectionId);
  return { statusCode: 200 };
};
