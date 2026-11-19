import type { ApiHandler } from './api-types';

/**
 * Runs a handler inside a span and logs how it went: the wrapper every route
 * file of this storefront ends with, `export default withTracing(handler)`.
 *
 * It hands the request on to the function it was given and returns nothing of
 * its own, which is what makes it a wrapper rather than a factory.
 */
export const withTracing = (handler: ApiHandler): ApiHandler => {
  return async (request, response) => {
    const started = Date.now();
    try {
      await handler(request, response);
    } finally {
      console.log(JSON.stringify({ path: request.url, status: response.statusCode, ms: Date.now() - started }));
    }
  };
};

/** Times any function, whatever it is handed: the newer router's handlers go through this one. */
export const withTiming =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    const started = Date.now();
    try {
      return await fn(...args);
    } finally {
      console.log(JSON.stringify({ ms: Date.now() - started }));
    }
  };

/** Refuses a request with no session cookie, then hands the rest on. */
export function withSession(handler: ApiHandler): ApiHandler {
  return async (request, response) => {
    if (request.headers['cookie'] === undefined) {
      response.status(401).send('');
      return;
    }
    return handler(request, response);
  };
}
