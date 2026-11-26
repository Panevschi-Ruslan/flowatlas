import { useQuery } from '@tanstack/react-query';
import { listOrders, type OrderSummary } from './api';

/** One row, handed the order as a prop: it reads the status. */
export function OrderRow({ order }: { order: OrderSummary }) {
  return <li>{order.status}</li>;
}

/** `/orders` in the app: the query's data, each order handed to a row. */
export function OrdersList() {
  const { data } = useQuery({ queryKey: ['orders'], queryFn: listOrders });
  return <ul>{data?.map((order) => <OrderRow key={order.id} order={order} />)}</ul>;
}
