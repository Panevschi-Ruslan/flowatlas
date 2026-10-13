import { respond } from '@acme/http-kit';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { findRental } from '../lib/rentals';
import { Status, type Refusal } from '../lib/types';

// The path param is read and nothing types it beyond a dictionary, so the path
// itself names it. The statuses are enum members the checker knows the value of.
export const handler = async (event: APIGatewayProxyEvent) => {
  const rental = await findRental(event.pathParameters?.rentalId ?? '');
  if (rental === undefined) {
    const refusal: Refusal = { reason: 'no such rental' };
    return respond(Status.NotFound, refusal);
  }
  return respond(Status.Ok, rental);
};
