import { listProducts } from '../../../lib/basket-store';
import { withTracing } from '../../../lib/with-tracing';

// The handler written in place inside the wrapper: it has no name, and is
// pointed at where it is written. It compares no method, so it answers ALL.
export default withTracing(async (_request, response) => {
  response.status(200).json(await listProducts());
});
