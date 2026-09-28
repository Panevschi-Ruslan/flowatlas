type RouteHandler = (request: Request) => Promise<Response>;

/**
 * A library that answers a route from a configuration rather than from a verb.
 *
 * The caller describes the work and is handed back an object holding one
 * handler per verb the library answers, so a route file written against it
 * exports a piece of a value rather than a name of its own. Queue and workflow
 * libraries are written this way, and the route file beside this one is the
 * `export const { POST } = serveJob(…)` that results.
 */
export const serveJob = (
  job: (request: Request) => Promise<void>,
): { POST: RouteHandler } => ({
  POST: async (request) => {
    await job(request);
    return new Response('queued', { status: 202 });
  },
});
