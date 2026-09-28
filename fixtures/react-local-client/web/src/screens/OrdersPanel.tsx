/**
 * The screen, which is where every address in this fixture is written.
 *
 * That is the point of reading the class at the call site rather than following a
 * verb inward: the caller writes the whole address and the verb is in the name,
 * so there is nothing left to work out and nothing to guess. A wrapper of plain
 * functions has to be followed outward to its callers before it says anything;
 * this shape says it all at once.
 */
import { api, type Order } from '../api/client.js';
import { billing } from '../api/billing.js';
import { reports } from '../api/reports.js';

export const OrdersPanel = () => {
  const load = () => api.get('/api/orders');
  const create = (order: Order) => api.post('/api/orders', order);
  const invoice = () => billing.put('/api/invoices', { paid: true });
  const summary = () => reports.get('/api/reports');
  // A verb-named member of a client that is not a request, which is why the
  // recognised verbs are the ones the class proved rather than all seven: this
  // produces neither a request nor a row, because there is nothing to say.
  const label = () => api.patch('/api/orders');

  return (
    <div>
      <button onClick={load}>Reload</button>
      <button onClick={() => create({ id: 'a', name: 'b' })}>Create</button>
      <button onClick={invoice}>Invoice</button>
      <button onClick={summary}>Summary</button>
      <span>{label()}</span>
    </div>
  );
};
