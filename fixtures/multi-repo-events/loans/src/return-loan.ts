import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events, type Loan } from './loan-events';

/** POST /loans/{loanId}/return, deployed with the bus's ARN rather than its name. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const loan = JSON.parse(event.body ?? '{}') as Loan;
  await events.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'library.loans',
          DetailType: 'LoanReturned',
          Detail: JSON.stringify(loan),
        },
      ],
    }),
  );
  return { statusCode: 200, body: '' };
};
