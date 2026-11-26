import { ORPCError } from '@orpc/server';

const stock = new Map<string, number>([['sku-1', 3]]);

export const findOrders = async (status?: string) => [{ id: 'o-1', sku: 'sku-1', quantity: 1, status }];

export const findOrder = async (id: string) => (id === 'o-1' ? { id, sku: 'sku-1', quantity: 1 } : undefined);

export const storeOrder = async (order: { sku: string; quantity: number }) => {
  if ((stock.get(order.sku) ?? 0) < order.quantity) throw new ORPCError('CONFLICT', { message: 'out of stock' });
  return { id: 'o-2', ...order };
};
