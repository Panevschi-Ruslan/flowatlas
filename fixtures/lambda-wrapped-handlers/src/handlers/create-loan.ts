import middy from '@middy/core';
import jsonBodyParser from '@middy/http-json-body-parser';
import type { APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { saveLoan } from '../lib/desk-table';
import { traced } from '../lib/wrappers';

interface CreateLoanEvent {
  body: { borrowerId: string; isbn: string };
}

const LOAN_DAYS = 21;

// A name, then the function, through a const the middleware chain is built on.
export const createLoanLogic = traced('createLoan', async (event: CreateLoanEvent): Promise<APIGatewayProxyResult> => {
  const due = new Date();
  due.setDate(due.getDate() + LOAN_DAYS);
  const loan = await saveLoan({
    loanId: `${event.body.borrowerId}-${event.body.isbn}`,
    borrowerId: event.body.borrowerId,
    isbn: event.body.isbn,
    dueOn: due.toISOString(),
  });
  return json(201, loan);
});

export const handler = middy(createLoanLogic).use(jsonBodyParser());
