import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { allStations } from '../lib/rentals';

// A function of the same name as the kit's, written here: not the kit's helper,
// so nothing it is handed is read as the answer.
const respond = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEvent) => {
  const found = (await allStations()).find((station) => station.stationId === event.pathParameters?.stationId);
  return respond(found === undefined ? 404 : 200, found ?? { reason: 'no such station' });
};
