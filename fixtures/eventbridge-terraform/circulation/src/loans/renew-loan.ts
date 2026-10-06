import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events, LIBRARY_BUS } from '../lib/events';
import { findLoan, saveLoan } from '../lib/loans-table';

export interface Renewal {
  loanId: string;
  dueOn: string;
  renewals: number;
}

/** POST /loans/{loanId}/renewals: the command is built in a local and sent a statement later. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const loan = await findLoan(event.pathParameters?.['loanId'] ?? '');
  if (loan === undefined) return { statusCode: 404, body: '' };
  const renewed = { ...loan, dueOn: '2026-11-22', renewals: loan.renewals + 1 };
  await saveLoan(renewed);
  const renewal: Renewal = { loanId: renewed.loanId, dueOn: renewed.dueOn, renewals: renewed.renewals };
  const command = new PutEventsCommand({
    Entries: [
      {
        EventBusName: LIBRARY_BUS,
        Source: 'library.loans',
        DetailType: 'LoanRenewed',
        Detail: JSON.stringify(renewal),
      },
    ],
  });
  await events.send(command);
  return { statusCode: 200, body: JSON.stringify(renewal) };
};
