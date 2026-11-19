/** What every event the orders service puts on its bus says it comes from. */
export const ORDERS_SOURCE = 'orders.service';

export interface Order {
  orderId: string;
  customerId: string;
  items: string[];
  status: 'placed' | 'shipped' | 'cancelled';
}
