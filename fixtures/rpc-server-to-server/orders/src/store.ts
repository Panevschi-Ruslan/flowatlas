const orders = new Map<string, { id: string; sku: string; quantity: number }>();

export const saveOrder = (order: { sku: string; quantity: number }) => {
  const id = `o-${orders.size + 1}`;
  orders.set(id, { id, ...order });
  return { id };
};

export const findOrder = (id: string) => orders.get(id) ?? null;
