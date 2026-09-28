import { restHandler } from 'rest-kit';

/**
 * A verb whose handler a library's call built out of a description.
 *
 * The way in is readable: the file is at `app/api/orders`, so the route is
 * `/api/orders` and the verb is the export's name. What is not readable is what
 * answers it — the call was handed a configuration object and the body lives in
 * the library, which ships types and no code. Before R94 this produced an entry,
 * a `handles` edge onto the call and no row, so it counted as a route with a
 * handler.
 *
 * The library is a package here, and until R153 it was a module of the
 * repository standing in for one. A factory the repository declares is code a
 * reader can open, and `app/api/products/route.ts` is that case now.
 */
export const GET = restHandler({ collection: 'orders' });
