import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as functions from '../lib/functions';
import { newLoan, type LoanRequest } from '../lib/loans';
import { startWorkflow } from '../lib/workflows';

/** POST /loans: starts the approval and tells the borrower, each through a helper. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = newLoan(JSON.parse(event.body ?? '{}') as LoanRequest);

  // The approval workflow, by the ARN the deployment hands this function.
  await startWorkflow(process.env.LOAN_APPROVAL_ARN, loan);

  // Through the module's namespace, by the function's deployed name.
  await functions.notifyFunction('lending-notify-borrower', { borrowerId: loan.borrowerId });

  return { statusCode: 202, body: JSON.stringify(loan) };
};
