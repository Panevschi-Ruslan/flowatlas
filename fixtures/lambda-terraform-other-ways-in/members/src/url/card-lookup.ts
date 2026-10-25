import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** Looks a library card up by the number in the query string. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const card = event.queryStringParameters?.['card'];
  return { statusCode: card === undefined ? 400 : 200, body: JSON.stringify({ card }) };
};
