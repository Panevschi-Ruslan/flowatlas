import type { Hono } from 'hono';

/**
 * Routes declared on an application that arrived from somewhere else.
 *
 * Whoever calls this decides where these are served, and this repository does
 * move applications around — `basePath` in one place, `route` in another — so
 * the address cannot be told from here. The refusal is the point: `/daily` on
 * its own would be a path this service does not serve.
 */
export const registerReports = (app: Hono): void => {
  app.get('/daily', (c) => c.text('daily'));
};
