import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { findLoan } from '../lib/loans-table';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = await findLoan(event.pathParameters?.loanId ?? '');
  return loan === undefined ? json(404, { message: 'no such loan' }) : json(200, loan);
};
