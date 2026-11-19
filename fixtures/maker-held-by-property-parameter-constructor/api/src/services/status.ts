import express, { Application } from 'express';

/**
 * Reached only through the map of lazy imports, never by its name. Its one
 * caller hands it the server's application, so the default is never used and
 * the route is as sure as that application.
 */
export default function init(app: Application = express()) {
  app.get('/api/status', (_req, res) => {
    res.json({ ok: true });
  });
}
