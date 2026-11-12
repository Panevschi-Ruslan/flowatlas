import billing from './api/billing';
import { legacyApi } from './api/legacy';
import { ordersApi } from './api/orders';
import { reports } from './api/reports';

export const Items = () => {
  const loadOrders = () => ordersApi.get('/items');
  const addOrder = () => ordersApi.post('/items', { name: 'pen' });
  const loadInvoices = () => billing.get('items').json();
  const addInvoice = () => reports('/items', { method: 'POST', body: { name: 'pen' } });
  const loadLegacy = () => legacyApi.get('/items');
  return (
    <section>
      <button onClick={loadOrders}>Orders</button>
      <button onClick={addOrder}>Add order</button>
      <button onClick={loadInvoices}>Invoices</button>
      <button onClick={addInvoice}>Add invoice</button>
      <button onClick={loadLegacy}>Legacy</button>
    </section>
  );
};
