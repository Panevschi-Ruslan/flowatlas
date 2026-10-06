import { orchestrator } from '@library/orchestration';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** POST /runs/{runId}/resume: starts a run recorded somewhere else. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // The id is the request's: nothing in this body says what the run starts.
  await orchestrator.start({ runId: event.pathParameters?.['runId'] ?? '' });
  return { statusCode: 202, body: '' };
};
