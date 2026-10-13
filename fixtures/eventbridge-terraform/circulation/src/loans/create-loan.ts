import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events, LIBRARY_BUS } from '../lib/events';
import { saveLoan, type Loan } from '../lib/loans-table';

/** POST /loans: records the loan and puts `LoanCreated` on the bus, the command built in the call. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const request = JSON.parse(event.body ?? '{}') as Pick<Loan, 'borrowerId' | 'itemId'>;
  const loan: Loan = { ...request, loanId: `${request.itemId}-${Date.now()}`, dueOn: '2026-11-01', renewals: 0 };
  await saveLoan(loan);
  await events.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: LIBRARY_BUS,
          Source: 'library.loans',
          DetailType: 'LoanCreated',
          Detail: JSON.stringify(loan),
        },
      ],
    }),
  );
  return { statusCode: 201, body: JSON.stringify(loan) };
};
