import Koa from 'koa';
import mount from 'koa-mount';
import api from './routes/api';
import auth from './routes/auth';

/**
 * Where the two applications are hung, and where every address comes from.
 *
 * `/api` and `/auth` are written here, one file and two mounts away from the
 * plugin routers that are served under them. That distance is the point of the
 * fixture: the segment is not missing because nobody wrote it, it is missing
 * because the mount in between was over a collection.
 */
export default function init(app: Koa = new Koa()): Koa {
  app.use(mount('/api', api));
  app.use(mount('/auth', auth));
  return app;
}
