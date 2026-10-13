import type { CreateOrder, Order } from './orders.types';

/** Somewhere to keep orders, so the routes have something typed to answer with. */
export const store = {
  find(id: string): Order | undefined {
    return id === '' ? undefined : { id, customerId: 'c1', total: 0 };
  },
  add(order: CreateOrder): Order {
    return { id: 'o1', customerId: order.customerId, total: order.total };
  },
  all(): any {
    return [];
  },
};
