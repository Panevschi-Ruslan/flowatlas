import { restHandler } from '../../../lib/rest';

/**
 * A verb whose handler a call built out of a description.
 *
 * The way in is readable: the file is at `app/api/orders`, so the route is
 * `/api/orders` and the verb is the export's name. What is not readable is what
 * answers it — the call was handed a configuration object and the body lives in
 * the library. Before R94 this produced an entry, a `handles` edge onto the call
 * and no row, so it counted as a route with a handler.
 */
export const GET = restHandler({ collection: 'orders' });
