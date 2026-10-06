import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '../lib/http';
import { extendLoan } from '../lib/loans-table';

const RENEWAL_DAYS = 14;

// Written in the chain itself: the function has no name of its own.
export const handler = middy(async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loan = await extendLoan(event.pathParameters?.loanId ?? '', RENEWAL_DAYS);
  return loan === undefined ? json(404, { message: 'no such loan' }) : json(200, loan);
}).use(httpErrorHandler());
