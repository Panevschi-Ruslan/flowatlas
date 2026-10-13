import middy from '@middy/core';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { registerBorrower } from '../lib/borrowers';

const audited = () => ({
  after: async () => {
    console.log('borrower registered');
  },
});

async function register(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const borrower = await registerBorrower(JSON.parse(event.body ?? '{}'));
  return { statusCode: 201, body: JSON.stringify(borrower) };
}

export const handler = middy(register).use(audited());
