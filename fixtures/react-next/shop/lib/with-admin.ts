type RouteHandler = (request: Request) => Promise<Response>;

/**
 * The wrapper an admin route is written through.
 *
 * Nothing about it is remarkable except where it leaves the handler: the verb a
 * file exports is the value this call hands back, so the module declares a
 * value and not a function, and every reader that asks what a module declares
 * is told there is no handler in the file at all.
 */
export const withAdmin =
  (handler: RouteHandler): RouteHandler =>
  async (request) => {
    if (request.headers.get('x-admin-token') === null) {
      return new Response('forbidden', { status: 403 });
    }
    return handler(request);
  };
