import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events, type Loan } from './loan-events';

/**
 * POST /loans. The bus is the value of EVENT_BUS_NAME, set where this
 * function is deployed; the bus itself is another repository's.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const loan = JSON.parse(event.body ?? '{}') as Loan;
  await events.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'library.loans',
          DetailType: 'LoanCreated',
          Detail: JSON.stringify(loan),
        },
      ],
    }),
  );
  return { statusCode: 201, body: JSON.stringify(loan) };
};
