const orders = new Map<string, { sku: string; quantity: number; shipped: boolean }>();

export const listOrders = async (sku?: string) =>
  [...orders.entries()].filter(([, order]) => sku === undefined || order.sku === sku).map(([id, order]) => ({ id, ...order }));

export const cancelOrder = async (id: string): Promise<'cancelled' | 'missing' | 'shipped'> => {
  const order = orders.get(id);
  if (order === undefined) return 'missing';
  if (order.shipped) return 'shipped';
  orders.delete(id);
  return 'cancelled';
};
