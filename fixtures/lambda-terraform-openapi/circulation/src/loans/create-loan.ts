import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { saveLoan, type Loan } from './loans-table';

/** POST /loans, integrated by its invoke ARN in the OpenAPI document. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const request = JSON.parse(event.body ?? '{}') as Pick<Loan, 'borrowerId' | 'itemId'>;
  const loan: Loan = { ...request, loanId: `${request.itemId}-${Date.now()}`, dueOn: '2026-11-01' };
  await saveLoan(loan);
  return { statusCode: 201, body: JSON.stringify(loan) };
};
