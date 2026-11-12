import { useMutation, useQuery } from '@tanstack/react-query';
import { client, orpc } from './orpc';

export function Orders() {
  const orders = useQuery(orpc.orders.list.queryOptions({ input: { status: 'open' } }));
  const place = useMutation(orpc.orders.place.mutationOptions());
  const key = orpc.orders.list.key();
  return (
    <button onClick={() => place.mutate({ sku: 'sku-1', quantity: 1 })}>
      {String(orders.data)}
      {String(key)}
    </button>
  );
}

export const showOrder = (id: string) => client.orders.get({ id });

/** A procedure nobody declares: renamed on the server and not here. */
export const refundOrder = (id: string) => client.orders.refund({ id });

/** A step of the path worked out at run time. */
export const listSection = (section: string) => client[section].list();

/** The same procedure asked for by its REST route, which the OpenAPI handler serves. */
export const fetchOrder = (id: string) => fetch(`${import.meta.env.VITE_API_URL}/api/v1/orders/${id}`);
