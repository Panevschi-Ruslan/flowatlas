import axios from 'axios';

import { billingApi } from './api/billing';
import { invoicesApi } from './api/invoices';
import { legacyApi } from './api/legacy';
import { ordersApi } from './api/orders';

export const Items = () => {
  const loadOrders = () => ordersApi.get('/items');
  const addOrder = () => ordersApi({ url: '/items', method: 'post', data: { name: 'pen' } });
  const loadBilling = () => billingApi('/items');
  const addInvoice = () => invoicesApi.post('items', { json: { name: 'pen' } });
  const loadAll = () => axios.request({ url: '/items' });
  const loadLegacy = () => legacyApi.get('/items');
  return (
    <section>
      <button onClick={loadOrders}>Orders</button>
      <button onClick={addOrder}>Add order</button>
      <button onClick={loadBilling}>Billing</button>
      <button onClick={addInvoice}>Add invoice</button>
      <button onClick={loadAll}>All</button>
      <button onClick={loadLegacy}>Legacy</button>
    </section>
  );
};
