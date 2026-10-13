import { notifier } from '@library/notify';
import { orchestrator, Process } from '@library/orchestration';
import { ErrorCode, problem } from '@library/problems';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { loanIdOf, type LoanRequest } from '../lib/loans';

/** POST /loans: records an approval run, then starts it. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const request = JSON.parse(event.body ?? '{}') as LoanRequest;

  // An error builder handed a member of an enum, from a package that is not
  // here: a call of the shape a start was once guessed from, which starts nothing.
  if (request.itemIds.length === 0) return problem(ErrorCode.EmptyLoan);

  const loanId = loanIdOf(request);

  // The run is recorded with what it is to run, and started by its id alone.
  const run = await orchestrator.create({ process: Process.LoanApproval, loanId });
  await orchestrator.start({ runId: run.id });

  // A helper installed with its types only, which say it holds a Lambda client.
  await notifier.send('lending-notify-borrower', { loanId });

  return { statusCode: 202, body: JSON.stringify({ loanId, runId: run.id }) };
};
