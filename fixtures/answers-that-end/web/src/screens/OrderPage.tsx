import { useEffect, useState } from 'react';

import { fetchOrder } from '../api/orders-api';

/** One order's screen: asks the shop for it when it opens. */
export function OrderPage({ id }: { id: string }) {
  const [status, setStatus] = useState('');

  useEffect(() => {
    void fetchOrder(id).then((order) => setStatus(order.status));
  }, [id]);

  return <p>{status}</p>;
}
