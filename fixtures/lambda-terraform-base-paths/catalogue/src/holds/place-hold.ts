import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const holds: string[] = [];

/** POST /requests of the holds API, which the domain maps at `holds`. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { itemId } = JSON.parse(event.body ?? '{}') as { itemId: string };
  holds.push(itemId);
  return { statusCode: 202, body: JSON.stringify({ itemId }) };
};
