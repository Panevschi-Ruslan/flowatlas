export interface Order {
  id: string;
  name: string;
}

const orders = new Map<string, Order>();

export const listOrders = (): Order[] => [...orders.values()];

export const findOrder = (id: string): Order | undefined => orders.get(id);

export const saveOrder = (name: string): Order => {
  const order = { id: String(orders.size + 1), name };
  orders.set(order.id, order);
  return order;
};

export const dropOrder = (id: string): boolean => orders.delete(id);

export const renameOrder = (id: string, name: string): Order | undefined => {
  const order = orders.get(id);
  if (order !== undefined) order.name = name;
  return order;
};
