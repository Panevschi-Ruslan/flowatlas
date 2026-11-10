import { AuditRepository, OrdersRepository, type Order } from './orders';

const orders = new OrdersRepository();
const audit = new AuditRepository('shop-audit');

export const handler = async (event: { body: string }) => {
  const order = JSON.parse(event.body) as Order;
  await orders.place(order);
  await audit.save({ id: order.id, action: 'placed' });
  return { statusCode: 201, body: JSON.stringify(order) };
};
