import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events, LIBRARY_BUS } from '../lib/events';

/** POST /loans/{loanId}/renewals: puts `LoanRenewed` on the library bus. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const loanId = event.pathParameters?.['loanId'] ?? '';
  await events.send(
    new PutEventsCommand({
      Entries: [{ EventBusName: LIBRARY_BUS, Source: 'library.loans', DetailType: 'LoanRenewed', Detail: JSON.stringify({ loanId }) }],
    }),
  );
  return { statusCode: 202, body: JSON.stringify({ loanId }) };
};
