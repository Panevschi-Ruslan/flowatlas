import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { json } from '../lib/http';
import { sqs } from '../lib/queues';

export interface LoanOpened {
  loanId: string;
  itemId: string;
  borrowerId: string;
  dueOn: string;
}

/**
 * POST /loans: opens a loan and announces it on the queue LOANS_OPENED_QUEUE_URL
 * names, which the archive reads.
 */
export const createLoan = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = JSON.parse(event.body ?? '{}') as LoanOpened;
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.LOANS_OPENED_QUEUE_URL,
      MessageBody: JSON.stringify(loan),
    }),
  );
  return json(201, loan);
};

/** POST /loans/{loanId}/renewals */
export async function renewLoan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return json(200, { loanId: event.pathParameters?.['loanId'], renewed: true });
}
