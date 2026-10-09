import middy from '@middy/core';
import jsonBodyParser from '@middy/http-json-body-parser';
import { respond } from '@acme/http-kit';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { startRental } from '../lib/rentals';
import type { Refusal, StartRental } from '../lib/types';

// The body parser in front hands the function the object, not the text, and
// the code says which object with a cast: a claim, since nothing checks it.
// The answer and the refusal both go through the kit's helper, each with the
// status written beside it.
const start = async (event: APIGatewayProxyEvent) => {
  const request = event.body as unknown as StartRental;
  const rental = await startRental(request.riderId, request.stationId);
  if (rental === undefined) {
    const refusal: Refusal = { reason: 'no bike free at this station' };
    return respond(409, refusal);
  }
  return respond(201, rental);
};

export const handler = middy(start).use(jsonBodyParser());
