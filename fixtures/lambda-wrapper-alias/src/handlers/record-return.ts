import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { closeLoan } from '../lib/desk-table';
import * as tracing from '../lib/tracing';

async function recordReturn(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const loan = await closeLoan(event.pathParameters?.loanId ?? '', new Date().toISOString());
  return loan === undefined ? json(404, { message: 'no such loan' }) : json(200, loan);
}

// Taken off the namespace in brackets, then named again.
const retrying = tracing['withRetry'];
const retried = retrying;

export const handler = retried({ attempts: 3 }, recordReturn);
