import express from 'express';

import { itemsRouter } from './items.routes';

/**
 * An application declared by a chain, which a video platform writes once and pays for
 * everywhere.
 *
 * `express().disable('x-powered-by')` hands back the application, so this is the
 * same declaration as `const app = express()` with one setting turned off. The
 * reader resolved the type of the receiver and could not see through the chain,
 * so `app` was not an application to it: every route in the repository was
 * reported as declared on something mounted somewhere it could not read, with a
 * hint telling the reader to mount the application at a literal path — which is
 * exactly what the line below does (R101).
 */
const app = express().disable('x-powered-by');

app.use('/api/v1', itemsRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(9000);
