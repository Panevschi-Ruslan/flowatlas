import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** POST /loans: a reader borrows a book, sent as a form with the reader's card. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => ({
  statusCode: 201,
  body: JSON.stringify({ received: (event.body ?? '').length }),
});
