import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findLoan, saveLoan } from './loans-table';

/** POST /loans/{loanId}/renewals, integrated by an ARN written around the function's. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = await findLoan(event.pathParameters?.['loanId'] ?? '');
  if (loan === undefined) return { statusCode: 404, body: '{}' };
  await saveLoan({ ...loan, dueOn: '2026-12-01' });
  return { statusCode: 200, body: JSON.stringify(loan) };
};
