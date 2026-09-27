import { trpc } from '../utils/trpc';

/**
 * A page of the same application that serves the tree, asking it for a
 * procedure. Nothing configures where this goes and nothing needs to: the
 * procedure is declared in this very repository, and that is the join.
 */
export default function OrdersPage() {
  const orders = trpc.orders.list.useQuery({ customerId: 'c-1' });
  return <ul>{String(orders.data)}</ul>;
}
