import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { loansOf } from '../../shared/loans-table';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const loans = await loansOf(event.pathParameters?.borrowerId ?? '');
  return { statusCode: 200, body: JSON.stringify(loans) };
}
