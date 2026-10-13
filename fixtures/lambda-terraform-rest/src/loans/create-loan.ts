import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import jsonBodyParser from '@middy/http-json-body-parser';
import type { APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { saveLoan } from '../lib/loans-table';

interface CreateLoanEvent {
  body: { borrowerId: string; isbn: string };
}

const LOAN_DAYS = 21;

async function createLoan(event: CreateLoanEvent): Promise<APIGatewayProxyResult> {
  const due = new Date();
  due.setDate(due.getDate() + LOAN_DAYS);
  const loan = await saveLoan({
    loanId: `${event.body.borrowerId}-${event.body.isbn}`,
    borrowerId: event.body.borrowerId,
    isbn: event.body.isbn,
    dueOn: due.toISOString(),
  });
  return json(201, loan);
}

// The handler the function is deployed with is the chain, and the code it runs
// is the function the chain wraps.
export const handler = middy(createLoan).use(jsonBodyParser()).use(httpErrorHandler());
