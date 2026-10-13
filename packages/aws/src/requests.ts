import type { RequestReadingDescription } from '@flowatlas/core';

/**
 * Where a request sits in what an API Gateway proxy integration hands a
 * function, and how the function answers it (P29).
 *
 * The shapes `@types/aws-lambda` declares for `APIGatewayProxyEvent` and its
 * HTTP API sibling: the body is text at `body`, which the function parses, and
 * the path params, query and headers are dictionaries beside it. The answer is
 * the object the function returns, the body as text at `body` and the status at
 * `statusCode`. A function whose event type says the body is already a shape -
 * a body parser in front of it, typed - is read off that type instead.
 */
export const GATEWAY_REQUEST: RequestReadingDescription = {
  parts: {
    body: [{ param: 0, at: ['body'], text: true }],
    params: [{ param: 0, at: ['pathParameters'] }],
    query: [{ param: 0, at: ['queryStringParameters'] }],
    headers: [{ param: 0, at: ['headers'] }],
  },
  answers: [{ by: 'return', at: ['body'], text: true, statusAt: ['statusCode'] }],
  defaults: [
    'APIGatewayProxyEventPathParameters',
    'APIGatewayProxyEventQueryStringParameters',
    'APIGatewayProxyEventHeaders',
  ],
};
