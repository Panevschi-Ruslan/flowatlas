import type { Hono } from 'hono';

/**
 * Routes declared on an application that arrived from somewhere else.
 *
 * Whoever calls this decides where these are served, and this repository does
 * move applications around — `basePath` in one place, `route` in another — so
 * the address is told from the callers: the one there hands the root
 * application, so `/daily` is served at the root (P354).
 */
export const registerReports = (app: Hono): void => {
  app.get('/daily', (c) => c.text('daily'));
};
