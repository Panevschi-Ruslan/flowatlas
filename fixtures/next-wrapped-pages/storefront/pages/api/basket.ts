import type { ApiRequest, ApiResponse } from '../../lib/api-types';
import { addToBasket, emptyBasket, readBasket, type BasketItem } from '../../lib/basket-store';
import { withTracing } from '../../lib/with-tracing';
import { quoteShipping } from '../../gateways/shipping.gateway';

/**
 * One handler, three verbs. The router sends every verb to the default export;
 * which ones this file answers is the `switch` on the method it takes out of
 * the request, so the way in is GET, POST and DELETE rather than ALL.
 */
const handler = async ({ method, body, query }: ApiRequest, response: ApiResponse) => {
  const sessionId = String(query['sessionId'] ?? '');
  switch (method) {
    case 'GET': {
      const items = await readBasket(sessionId);
      const shipping = await quoteShipping(items);
      return response.status(200).json({ items, shipping });
    }
    case 'POST': {
      const { item } = body as { item: BasketItem };
      return response.status(200).json(await addToBasket(sessionId, item));
    }
    case 'DELETE': {
      await emptyBasket(sessionId);
      return response.status(204).send('');
    }
    default:
      return response.status(405).send('');
  }
};

// The wrapper is the export; the function it is handed is the handler.
export default withTracing(handler);
