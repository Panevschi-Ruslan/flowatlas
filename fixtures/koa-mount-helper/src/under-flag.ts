import type Application from 'koa';
import type { Middleware } from 'koa';

/**
 * A mount helper of the repository's own, which nothing can have described.
 *
 * `MOUNT_HELPERS` holds a record per published package, and this is not one: it
 * is three lines in this repository, and the next repository's helper will be
 * three different lines. So it stands here for every helper the tool has no row
 * for, and what it must produce is the reading from before any row existed — the
 * application is found among the arguments, the mount has no readable path, and
 * a route under it is reported rather than recorded at an address nothing serves.
 */
export const underFlag =
  (app: Application): Middleware =>
  (ctx, next) => {
    ctx.status = 200;
    return app === undefined ? next() : app;
  };
