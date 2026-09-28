import express from 'express';
import { authRouter } from './auth.routes';
import { documentsRouter } from './documents.routes';

/**
 * The application, and the one line that decides what every route's address is.
 *
 * The mount carries `/api`, so `POST /documents.info` is served at
 * `POST /api/documents.info`. The browser half of this repository never writes
 * that segment at a call site, because the client it writes every request
 * through holds it — which is the same fact, read at the other end.
 */
export const app = express();

app.use(express.json());
app.use('/api', documentsRouter);
// The second mount, and the reason a call may need a base of its own.
app.use('/auth', authRouter);

app.listen(3000);
