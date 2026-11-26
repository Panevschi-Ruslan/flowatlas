import { flow } from 'lodash';
import { CartDocument, OrdersDocument, runQuery } from './graphql';
import { getJson } from './http';

/** A store whose methods are the callers of the helpers they hand an address or a document. */
export class OrdersStore {
  /** A composition held by a field of the class: each call of it hands `runQuery` its document. */
  private quietQuery = flow(runQuery, (result) => result);

  load() {
    return getJson('/api/orders');
  }

  item = (id: string) => getJson(`/api/orders/${id}`);

  refreshCart() {
    return this.quietQuery(CartDocument);
  }
}

/** A composition called where it is made. */
export const loadOrdersNow = () => flow(runQuery, (result) => result)(OrdersDocument);

export const ordersStore = new OrdersStore();
