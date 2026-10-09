import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findBorrower } from '../lib/borrowers';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const borrower = await findBorrower(event.pathParameters?.borrowerId ?? '');
  return { statusCode: borrower === undefined ? 404 : 200, body: JSON.stringify(borrower ?? {}) };
}
