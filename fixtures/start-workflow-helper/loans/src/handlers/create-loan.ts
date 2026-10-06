import { orchestrator, Process } from '@library/orchestration';
import { workflows } from '@library/workflows';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { newLoan, type LoanRequest } from '../lib/loans';

/** POST /loans: starts the approval, and has the copies reserved. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = newLoan(JSON.parse(event.body ?? '{}') as LoanRequest);

  // Through the service's own client, a package of this repository: which
  // workflow is the ARN the deployment hands this function.
  await workflows.start(process.env.LOAN_APPROVAL_ARN, loan);

  // Through the orchestration package every service of the library shares,
  // from a registry this checkout has no access to: it is not installed.
  await orchestrator.run(Process.ReserveCopies, { loanId: loan.loanId, itemIds: loan.itemIds });

  return { statusCode: 202, body: JSON.stringify(loan) };
};
