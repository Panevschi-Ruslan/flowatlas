import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';

/** POST /holds */
export const placeHold = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> =>
  json(201, JSON.parse(event.body ?? '{}'));

/** DELETE /holds/{holdId}: deployed as `cancelHold`, written as `withdrawHold`. */
export const withdrawHold = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> =>
  json(200, { holdId: event.pathParameters?.['holdId'], withdrawn: true });
