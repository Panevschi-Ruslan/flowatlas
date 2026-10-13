import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { startWorkflow as start } from '../lib/workflows';

/** POST /loans/{loanId}/renewals: a renewal is approved the way a loan is. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loanId = event.pathParameters?.['loanId'] ?? '';

  // The same helper under another name, handed the deployed name itself.
  await start('lending-loan-approval', { loanId, renewal: true });

  return { statusCode: 202, body: '' };
};
