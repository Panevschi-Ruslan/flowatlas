import { trpc } from '../lib/trpc';

/** Asks the tree by the root's keys, as the client typed from it writes them. */
export function Orders() {
  const orders = trpc.shop.orders.list.useQuery();
  const place = trpc.shop.orders.place.useMutation();
  const products = trpc.shop.catalog.search.useQuery();
  return (
    <button onClick={() => place.mutate()}>
      {String(orders.data)} {String(products.data)}
    </button>
  );
}
