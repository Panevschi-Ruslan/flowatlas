import { restHandler } from 'rest-kit';

type Handler = (request: Request) => Promise<Response>;

/** A table of handlers a route file takes one name out of. */
export const vendorRoutes: { PUT: Handler; DELETE: Handler } = {
  PUT: async () => new Response('updated'),
  DELETE: async () => new Response('gone'),
};

/** One handler reachable as a property, which is how a plugin exposes them. */
export const vendor = {
  handlers: {
    POST: async () => new Response('created'),
  },
};

/**
 * A handler a library's call built, for the older router to export as its
 * default. The library is a package: see `app/api/orders/route.ts`.
 */
export const legacyHandler = restHandler({ collection: 'legacy' });
