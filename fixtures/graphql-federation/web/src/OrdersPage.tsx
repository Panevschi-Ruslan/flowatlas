import { useQuery } from '@apollo/client';

import { ORDERS } from './queries';

export const OrdersPage = () => {
  const { data } = useQuery(ORDERS);
  return (
    <ul>
      {data?.orders.map((order) => (
        <li key={order.id}>
          {order.customer.name} {order.total}
        </li>
      ))}
    </ul>
  );
};
