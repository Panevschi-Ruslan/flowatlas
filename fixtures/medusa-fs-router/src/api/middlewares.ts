import { authenticate, defineMiddlewares } from '@medusajs/framework';
import { adminOrderRoutesMiddlewares } from './admin/orders/middlewares.js';

/**
 * What stands in front of the routes, as a declarative list.
 *
 * A framework with no call site for a route has none for its middleware either,
 * so the list is data: an address pattern, the verbs it covers, and the functions
 * it installs. Three things are asserted here — the spread of a list from another
 * file, the two spellings of the verbs an entry covers, and a matcher written as
 * a regular expression, which is the one thing here that cannot be turned into a
 * test on an address and therefore gets a row rather than a claim.
 */
export default defineMiddlewares([
  ...adminOrderRoutesMiddlewares,
  {
    matcher: '/store/products',
    methods: ['GET'],
    middlewares: [authenticate('customer', ['bearer'])],
  },
  {
    matcher: /^\/hooks\/.*$/,
    middlewares: [authenticate('provider', ['api-key'])],
  },
  {
    // An entry that installs nothing this could name says nothing about what is
    // in front of the routes it covers, and is left out rather than recorded
    // empty: a route whose only entry names no function must read the same as a
    // route with no entry at all.
    matcher: '/store*',
  },
]);
