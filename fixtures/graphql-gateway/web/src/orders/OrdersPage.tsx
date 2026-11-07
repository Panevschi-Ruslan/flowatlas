import { useMutation, useQuery } from '@apollo/client';

import { PlaceOrderDocument } from '../gql/graphql';
import { ORDERS } from './queries';

export const OrdersPage = () => {
  const { data } = useQuery(ORDERS);
  const [placeOrder] = useMutation(PlaceOrderDocument);
  const place = () => placeOrder({ variables: { input: { customerId: 'c1', total: 10 } } });
  return (
    <section>
      <button onClick={place}>Place an order</button>
      <ul>
        {data?.orders.map((order) => (
          <li key={order.id}>{order.customer.name}</li>
        ))}
      </ul>
    </section>
  );
};
