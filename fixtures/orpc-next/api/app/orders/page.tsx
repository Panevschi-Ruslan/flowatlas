import { call, createRouterClient } from '@orpc/server';
import { getOrder } from '../../src/server/orders';
import { router } from '../../src/server/router';

const caller = createRouterClient(router, { context: { user: { id: 'u-1' } } });

/** A page rendered on the server, asking its own procedures in process. */
export default async function OrdersPage() {
  const orders = await caller.orders.list({ status: 'open' });
  const first = await call(getOrder, { id: 'o-1' }, { context: { user: { id: 'u-1' } } });
  return (
    <ul>
      <li>{String(first)}</li>
      {String(orders)}
    </ul>
  );
}
