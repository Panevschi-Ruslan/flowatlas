import { getJson } from './http';
import { loadOrdersNow, ordersStore } from './orders-store';
import { storeApi, storeHooks } from './sdk-client';

export const OrdersPage = () => {
  const orders = storeHooks.useOrderListInfinite('orders');
  const load = () => {
    ordersStore.load();
    ordersStore.item('42');
    ordersStore.refreshCart();
    loadOrdersNow();
    storeApi.cartLines();
    getJson('/api/cart');
  };
  return <button onClick={load}>{String(orders)}</button>;
};
