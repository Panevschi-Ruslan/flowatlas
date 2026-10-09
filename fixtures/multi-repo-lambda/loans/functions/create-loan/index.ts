import middy from '@middy/core';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { saveLoan } from '../../shared/loans-table';

const logged = () => ({
  before: async (request: { event: APIGatewayProxyEvent }) => {
    console.log(request.event.path);
  },
});

const createLoan = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { borrowerId, isbn } = JSON.parse(event.body ?? '{}') as { borrowerId: string; isbn: string };
  const loan = await saveLoan({ loanId: `${borrowerId}-${isbn}`, borrowerId, isbn, dueOn: new Date().toISOString() });
  return { statusCode: 201, body: JSON.stringify(loan) };
};

export const handler = middy(createLoan).use(logged());
