import type { ApiRequest, ApiResponse } from '../../lib/api-types';
import { emptyBasket } from '../../lib/basket-store';
import { withSession, withTracing } from '../../lib/with-tracing';

/** A handler that answers one verb and turns the rest away by comparing the method. */
async function placeOrder(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') return response.status(405).send('');
  await emptyBasket(String(request.query['sessionId'] ?? ''));
  return response.status(201).json({ placed: true });
}

// Two wrappers, one inside the other: both run in front of the handler, outermost first.
export default withTracing(withSession(placeOrder));
