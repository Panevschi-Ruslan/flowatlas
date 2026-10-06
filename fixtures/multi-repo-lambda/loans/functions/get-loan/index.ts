import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findLoan } from '../../shared/loans-table';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = await findLoan(event.pathParameters?.loanId ?? '');
  return loan === undefined ? { statusCode: 404, body: '{}' } : { statusCode: 200, body: JSON.stringify(loan) };
};
