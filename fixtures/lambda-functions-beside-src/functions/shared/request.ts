import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export interface HoldRequest {
  isbn: string;
  borrowerId: string;
}

/** The request body, read once for every handler that takes one. */
export const readHoldRequest = (event: APIGatewayProxyEvent): HoldRequest => {
  const body = JSON.parse(event.body ?? '{}') as Partial<HoldRequest>;
  return { isbn: body.isbn ?? '', borrowerId: body.borrowerId ?? '' };
};

export const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
