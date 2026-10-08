import * as kit from '@acme/http-kit';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { endRental } from '../lib/rentals';
import type { EndRental } from '../lib/types';

const OK = 200;

// The body comes back from the kit's own parser, typed by the type argument
// the call asks for - a claim, like a cast. The helper is reached through a
// namespace import, and the status is a constant.
export const handler = async (event: APIGatewayProxyEvent) => {
  const request = kit.readJson<EndRental>(event);
  const receipt = await endRental(`${request.stationId}:${event.pathParameters?.rentalId ?? ''}`);
  return kit.respond(OK, receipt);
};
