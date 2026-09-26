import Koa from 'koa';
import mount from 'koa-mount';

import { api } from './api';
import { healthRouter } from './health.routes';

/**
 * A mount written through a helper, which is how outline mounts five applications.
 *
 * `mount('/api', api)` hands back middleware. The argument `app.use` receives is
 * therefore not an application, so the reader used to see an ordinary middleware
 * install, drop the prefix, and record every route of `api` at the address it is
 * written at — `POST /documents.info` for what the service serves at
 * `POST /api/documents.info`. 253 of outline's 257 routes were at an address
 * nothing serves, with no row to say so (R84).
 *
 * The prefix lives in the helper's arguments under the helper's own meaning, and
 * nothing here knows that meaning, so the address is not read. What is read is
 * that `api` is mounted somewhere, which is enough to stop claiming it is served
 * where its routes are written: a route of it is now reported rather than
 * recorded at an address that cannot join to any caller.
 */
const app = new Koa();

app.use(mount('/api', api));

// Installed directly, so this one keeps its address and is read as before.
app.use(healthRouter.routes());

app.listen(3000);
