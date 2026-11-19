import express, { Application } from 'express';

/**
 * A parameter whose default is a maker's value, handed round a list by its
 * only caller: whatever the list's callback hands it, nothing here can say.
 */
export function mountReports(app: Application = express()) {
  app.get('/api/reports', (_req, res) => {
    res.json([]);
  });
}
