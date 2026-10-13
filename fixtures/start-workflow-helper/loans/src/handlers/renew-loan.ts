import { orchestrator } from '@library/orchestration';
import { Reminder, scheduler } from '@library/scheduling';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** POST /loans/{loanId}/renewals: a renewal is approved the way a loan is. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loanId = event.pathParameters?.['loanId'] ?? '';

  // The same helper, handed the deployed name itself.
  await orchestrator.run('lending-loan-approval', { loanId, renewal: true });

  // Another shared package, not installed and not described.
  await scheduler.schedule(Reminder.LoanDue, { loanId });

  return { statusCode: 202, body: '' };
};
