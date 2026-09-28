import express from 'express';

import { serve } from './admin';
import { videosRouter } from './videos.routes';

/**
 * A video platform's declaration of its one application, with nothing installed.
 *
 * `express` has no types here, so `app` is `any` to the checker. What the source
 * states is enough: the default export of `express` makes an application, and
 * `disable` hands the application back (R142).
 */
const app = express().disable('x-powered-by');

app.use(express.json());
app.use('/api/v1', videosRouter);
app.use('/admin', serve());

// A setting read, not a route: one argument.
app.get('trust proxy');

// A commerce monorepo's `GET /health`, written in place.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(9000);
