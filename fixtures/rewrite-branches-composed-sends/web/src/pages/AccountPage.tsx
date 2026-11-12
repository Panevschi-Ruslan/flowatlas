import { apiClient } from '../api/client';
import { http } from '../api/http';
import { listOrders } from '../backend/orders';
import { storeApi, storeHooks } from '../backend/store';

declare const section: string;

export const AccountPage = () => {
  const { data } = storeHooks.useOrders('orders');
  const load = async () => {
    await http.get('/admin/users');
    await http.get('/products');
    // What the address holds is not read, so neither side of the branch can be chosen.
    await http.get('/' + section + '/list');
    await apiClient.get('/orders.csv');
    await apiClient.get('/orders');
    await listOrders();
    await storeApi.SignIn({ email: 'a@b.c' });
  };
  return <button onClick={() => void load()}>{data?.orders.length ?? 0}</button>;
};
