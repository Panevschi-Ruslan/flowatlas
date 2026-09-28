import Koa from 'koa';

import { documentsRouter } from './documents.routes';

/** An application of its own, which the server hangs under a prefix. */
export const api = new Koa();

api.use(documentsRouter.routes());
