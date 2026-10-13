import * as kit from '@acme/http-kit';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { endRental } from '../lib/rentals';
import type { EndRental } from '../lib/types';

const OK = 200;

// The body comes back from the kit's own parser, typed by the type argument
// the call asks for - a claim, like a cast. The helper is reached through a
// namespace import, and the status is a constant. A return to no station is
// refused through the kit's other helper, which builds the failure from a
// code and a message handed to it one by one.
export const handler = async (event: APIGatewayProxyEvent) => {
  const request = kit.readJson<EndRental>(event);
  if (request.stationId === '') return kit.fail(422, 'no_station', 'a bike is returned to a station');
  const receipt = await endRental(`${request.stationId}:${event.pathParameters?.rentalId ?? ''}`);
  return kit.respond(OK, receipt);
};
