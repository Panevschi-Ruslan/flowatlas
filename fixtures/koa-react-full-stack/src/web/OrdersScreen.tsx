/**
 * The browser half: one screen, calling the two routes its own server serves.
 *
 * Both halves are in one directory and share one manifest, so the address on the
 * left of this file and the route on the right of `src/server/orders.routes.ts`
 * can only be joined by a reading that opened both.
 */
import { api } from './api/client.js';

export const OrdersScreen = () => {
  const load = () => api.get('/api/orders');
  const create = () => api.post('/api/orders', { total: 1 });

  return (
    <div>
      <button onClick={load}>Reload</button>
      <button onClick={create}>Create</button>
    </div>
  );
};
