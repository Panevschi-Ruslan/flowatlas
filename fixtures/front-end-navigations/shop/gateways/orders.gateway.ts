import axios from 'axios';

const client = axios.create({ baseURL: 'http://orders.internal' });

// Every request the orders client makes carries the shop's name.
client.defaults.headers.common['X-Shop'] = 'shop';

/**
 * The orders gateway: a factory handing back an object of functions, the module
 * exporting what one call of it made. A route calls `OrdersGateway.list()`.
 */
const OrdersGateway = () => ({
  async list() {
    const { data } = await client.get<string[]>('/orders');
    return data;
  },
  async latest() {
    const ids = await this.list();
    return ids[0];
  },
  remove: async (id: string) => {
    await client.delete(`/orders/${id}`);
  },
});

export default OrdersGateway();
