import { InvokeCommand } from '@aws-sdk/client-lambda';
import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { lambda, payloadOf, sfn } from '../lib/clients';
import { newLoan, type LoanRequest } from '../lib/loans';

/** The function that tells a borrower, addressed by its ARN. */
const NOTIFY_BORROWER = 'arn:aws:lambda:eu-west-1:111122223333:function:lending-notify-borrower';

/** POST /loans: holds the copies, starts the approval and tells the borrower. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = newLoan(JSON.parse(event.body ?? '{}') as LoanRequest);

  // Waits for the copies to be held: an invocation that answers.
  await lambda.send(new InvokeCommand({ FunctionName: 'lending-hold-copies', Payload: payloadOf(loan) }));

  // The approval workflow, by the ARN the deployment hands this function.
  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: process.env.LOAN_APPROVAL_ARN,
      name: loan.loanId,
      input: JSON.stringify(loan),
    }),
  );

  // Hands the notice over and does not wait for it.
  await lambda.send(
    new InvokeCommand({
      FunctionName: NOTIFY_BORROWER,
      InvocationType: 'Event',
      Payload: payloadOf({ borrowerId: loan.borrowerId }),
    }),
  );

  return { statusCode: 202, body: JSON.stringify(loan) };
};
