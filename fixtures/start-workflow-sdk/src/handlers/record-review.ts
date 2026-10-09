import { SendTaskFailureCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { sfn } from '../lib/clients';

interface Review {
  taskToken: string;
  approved: boolean;
  note?: string;
}

/**
 * POST /reviews: a librarian's answer to the approval that is waiting for it.
 * The token names the waiting run, and no workflow.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const review = JSON.parse(event.body ?? '{}') as Review;
  if (review.approved) {
    await sfn.send(new SendTaskSuccessCommand({ taskToken: review.taskToken, output: JSON.stringify({ approved: true }) }));
  } else {
    await sfn.send(new SendTaskFailureCommand({ taskToken: review.taskToken, error: 'LoanDeclined', cause: review.note }));
  }
  return { statusCode: 204, body: '' };
};
