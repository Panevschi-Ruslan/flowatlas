import Koa from 'koa';
import Router from '@koa/router';
import AuthenticationHelper from '../models/AuthenticationHelper';

/**
 * The authentication application, whose routers arrive the long way round.
 *
 * Three hops between the mount and the collection, all of them in the real
 * repository this is modelled on: the collection is behind a static getter, the
 * loop is a `for…of` rather than a `forEach`, and the router is awaited into a
 * name of its own before it is mounted. The keys read off a member are
 * `value.router` here and `value` in `api.ts`, which is what sends each router
 * to the one of the two applications that really installs it.
 */
const auth = new Koa();
const router = new Router();

void (async () => {
  for (const provider of AuthenticationHelper.providers) {
    const resolved = await provider.value.router;
    router.use('/', resolved.routes());
  }
})();

auth.use(router.routes());

export default auth;
