import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

interface Rating {
  readonly stars: number;
  readonly comment?: string;
}

/** POST /books/{bookId}/ratings: a reader's rating of one book. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const rating = JSON.parse(event.body ?? '{}') as Rating;
  return { statusCode: 201, body: JSON.stringify({ bookId: event.pathParameters?.bookId, stars: rating.stars }) };
};
