import express from 'express';
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

app.listen(3000);
