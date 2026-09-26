import Koa from 'koa';
import mount from 'koa-mount';

import { admin } from './admin';
import { api } from './api';
import { healthRouter } from './health.routes';
import { pages } from './pages';
import { underFlag } from './under-flag';

/**
 * A mount written through a helper, which is how outline mounts five applications.
 *
 * `mount('/api', api)` hands back middleware. The argument `app.use` receives is
 * therefore not an application, so the reader saw an ordinary middleware install,
 * dropped the prefix, and recorded every route of `api` at the address it is
 * written at — `POST /documents.info` for what the service serves at
 * `POST /api/documents.info`. 253 of outline's 257 routes were at an address
 * nothing serves, with no row to say so (R84). The fix for that stopped
 * publishing the wrong address and read no address at all instead.
 *
 * The prefix is in the call. Which argument of the call it is, is a fact about
 * `koa-mount` rather than about Koa or about anything a reader could work out, so
 * it is one record in `MOUNT_HELPERS` and the address is read again (R110). The
 * three mounts below are the three cases that record decides between: a described
 * helper given a prefix, a described helper handed the application alone, and a
 * helper nobody described.
 *
 * The application is a parameter with a default, as outline's is, because that is
 * the second half of the same address. outline starts its services through a map
 * of dynamic imports, so no call to this function can be followed from here, and
 * the default is the only statement in the repository about what `app` is. A
 * reader that would not read it has the prefix and still cannot place a route.
 */
export default function init(app: Koa = new Koa()): Koa {
  app.use(mount('/api', api));

  // The same shape through a helper nothing describes. The application is still
  // found, so its routes are not claimed at the addresses they are written at,
  // and the prefix stays unread because nothing here knows this helper's meaning.
  app.use(underFlag(admin));

  // The described helper with no prefix argument, which is how outline writes one
  // of its five: mounted at the base of the application it is installed on.
  app.use(mount(pages));

  // Installed directly, so this one keeps its address and is read as before.
  app.use(healthRouter.routes());

  return app;
}
