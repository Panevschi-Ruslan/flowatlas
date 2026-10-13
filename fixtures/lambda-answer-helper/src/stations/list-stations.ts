import { respond } from '@acme/http-kit';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { allStations } from '../lib/rentals';

// The status is worked out at run time, so the list could be the answer or a
// failure's body: it is kept apart from both rather than guessed into one.
export const handler = async (event: APIGatewayProxyEvent) => {
  const stations = await allStations();
  const status = stations.length > 0 ? 200 : Number(event.queryStringParameters?.emptyStatus ?? 404);
  return respond(status, stations);
};
