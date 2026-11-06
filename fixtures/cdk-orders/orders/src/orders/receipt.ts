import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';

/** Behind its own function URL: a printable receipt for a link sent by e-mail. */
export const handler = async (event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> => ({
  statusCode: 200,
  headers: { 'content-type': 'text/plain' },
  body: `receipt for ${event.queryStringParameters?.['order'] ?? 'nothing'}`,
});
