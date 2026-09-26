type Handler = (request: Request) => Promise<Response>;

/**
 * A library that builds a route handler out of a description.
 *
 * This is the dominant shape in the ecosystem's larger repositories: the route
 * file hands over a configuration object and the library hands back the handler.
 * The call is written in the repository and everything that happens when the
 * request arrives is written inside the library, so the way in is readable and
 * the code behind it is not.
 */
export const restHandler = (config: { collection: string }): Handler =>
  async () => Response.json({ collection: config.collection });

/** The same, as a table of handlers a route file takes one name out of. */
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

/** A handler built by a call, for the older router to export as its default. */
export const legacyHandler = restHandler({ collection: 'legacy' });
