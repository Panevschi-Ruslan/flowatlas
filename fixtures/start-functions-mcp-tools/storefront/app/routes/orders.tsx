import { useEffect, useState } from 'react';
import { listOrders, placeOrder } from '../server/orders.functions';

/** The page that lists the orders and places one: two calls across the boundary. */
export function OrdersPage() {
  const [orders, setOrders] = useState<Array<{ id: string }>>([]);

  useEffect(() => {
    void listOrders().then(setOrders);
  }, []);

  const order = async (): Promise<void> => {
    await placeOrder({ data: { sku: 'tea', quantity: 1 } });
  };

  return (
    <section>
      <button onClick={order}>Order</button>
      <ul>
        {orders.map((each) => (
          <li key={each.id}>{each.id}</li>
        ))}
      </ul>
    </section>
  );
}
