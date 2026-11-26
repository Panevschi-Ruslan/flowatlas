import { makeProbe } from '../../lib/basket-store';

// A factory of this repository handed only values: the handler is the function
// it returns, so the way in points at the factory.
export default makeProbe({ name: 'storefront' });
