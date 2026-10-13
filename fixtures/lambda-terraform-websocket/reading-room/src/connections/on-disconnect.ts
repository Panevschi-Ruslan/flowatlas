import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { forget } from './connections-table';

/** `$disconnect`: the borrower leaves. */
export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => {
  await forget(event.requestContext.connectionId);
  return { statusCode: 200 };
};
