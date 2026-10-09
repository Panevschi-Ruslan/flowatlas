import { workflows } from '@library/workflows';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { newLoan, type LoanRequest } from '../lib/loans';

/** POST /loans: starts the approval through the workspace's own client. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = newLoan(JSON.parse(event.body ?? '{}') as LoanRequest);

  // Which workflow is the ARN the deployment hands this function.
  await workflows.start(process.env.LOAN_APPROVAL_ARN, loan);

  return { statusCode: 202, body: JSON.stringify(loan) };
};
