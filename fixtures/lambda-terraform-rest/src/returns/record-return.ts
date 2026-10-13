import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { closeLoan } from '../lib/loans-table';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { loanId } = JSON.parse(event.body ?? '{}') as { loanId: string };
  const loan = await closeLoan(loanId, new Date().toISOString());
  return loan === undefined ? json(404, { message: 'no such loan' }) : json(200, loan);
}
