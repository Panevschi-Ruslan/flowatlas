import { listStores } from '../../../lib/basket-store';
import { withTiming } from '../../../lib/with-tracing';

async function readStores(): Promise<Response> {
  return Response.json(await listStores());
}

// The newer router's spelling of the same shape: a verb export that is a
// wrapper handed a function declared here. The handler is that function.
export const GET = withTiming(readStores);
