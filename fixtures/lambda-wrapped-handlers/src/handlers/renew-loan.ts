import middy from '@middy/core';
import jsonBodyParser from '@middy/http-json-body-parser';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { extendLoan } from '../lib/desk-table';
import { traced } from '../lib/wrappers';

const RENEWAL_DAYS = 14;

async function renewLoan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const loan = await extendLoan(event.pathParameters?.loanId ?? '', RENEWAL_DAYS);
  return loan === undefined ? json(404, { message: 'no such loan' }) : json(200, loan);
}

// A name, then the function, written inline inside the middleware chain.
export const handler = middy(traced('renewLoan', renewLoan)).use(jsonBodyParser());
