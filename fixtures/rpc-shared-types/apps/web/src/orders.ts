import { trpc } from './trpc';

/** Hands the input the shared type declares, and reads back what it answers. */
export function placeOrder(sku: string, quantity: number) {
  return trpc.orders.place.mutate({ sku, quantity });
}

export function findOrder(id: string) {
  return trpc.orders.get.query({ id });
}
