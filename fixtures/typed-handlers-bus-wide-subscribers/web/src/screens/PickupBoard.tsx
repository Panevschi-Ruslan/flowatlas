import { useEffect, useState } from 'react';

interface PickupEvent {
  type: string;
  orderId: string;
}

/** The pickup screen: holds the orders stream open, choosing by type in a handler written in place. */
export function PickupBoard() {
  const [ready, setReady] = useState<string[]>([]);

  useEffect(() => {
    const source = new EventSource(`${import.meta.env.VITE_SHOP_URL}/events/stream`);
    source.onmessage = (m) => {
      const evt = JSON.parse(m.data) as PickupEvent;
      if (evt.type === 'ORDER_READY') setReady([...ready, evt.orderId]);
      else if (evt.type === 'ORDER_CANCELLED') setReady(ready.filter((id) => id !== evt.orderId));
    };
    return () => source.close();
  }, []);

  return <ul>{ready.join(',')}</ul>;
}
