import { productsHandler } from '../../../lib/products';

/**
 * A verb whose handler a factory of this repository built.
 *
 * The same spelling as `app/api/orders/route.ts` - a call handed a
 * configuration object - with one difference that decides everything: the
 * function called is declared in this repository, so the handler it returns is
 * written in its body and a reader can open it. Before R153 this was read as
 * the orders route is, "nothing declared in this repository was handed to that
 * call", because only the arguments were looked at and not the function called.
 */
export const GET = productsHandler({ collection: 'products' });
