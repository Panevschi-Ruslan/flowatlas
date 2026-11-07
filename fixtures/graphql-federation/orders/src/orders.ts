export interface Order {
  id: string;
  total: number;
  customerId: string;
}

const orders: Order[] = [];

export const listOrders = (): Order[] => orders;

export const findOrder = (id: string): Order | undefined => orders.find((order) => order.id === id);

export const customerOrders = (customerId: string): Order[] => orders.filter((order) => order.customerId === customerId);

export const placeOrder = (input: { customerId: string; total: number }): Order => {
  const order = { id: String(orders.length + 1), ...input };
  orders.push(order);
  return order;
};
