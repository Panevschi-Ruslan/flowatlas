import type { APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { saveLoan } from '../lib/desk-table';
import * as tracing from '../lib/tracing';

interface CreateLoanEvent {
  body: { borrowerId: string; isbn: string };
}

const LOAN_DAYS = 21;

// The wrapper taken off the namespace into a name of this module.
const traced = tracing.traced;

export const handler = traced('createLoan', async (event: CreateLoanEvent): Promise<APIGatewayProxyResult> => {
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
