import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { extendLoan } from '../lib/desk-table';
import { traced as t } from '../lib/tracing';

const RENEWAL_DAYS = 14;

async function renewLoan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const loan = await extendLoan(event.pathParameters?.loanId ?? '', RENEWAL_DAYS);
  return loan === undefined ? json(404, { message: 'no such loan' }) : json(200, loan);
}

// The wrapper imported under a short name.
export const handler = t('renewLoan', renewLoan);
