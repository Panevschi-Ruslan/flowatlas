import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { appRouter } from '../server/root';

const client = createTRPCClient<typeof appRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })],
});

/**
 * The other half of the boundary, and the string this fixture is here to pin.
 *
 * `orders.list` is written at the call site verbatim, letter for letter, and it is
 * also the key of the entry point the server half produces. Nothing joins the two
 * yet — a caller reaching a way in that has no URL is drawn by a pass that has the
 * reference graph, and there is no such pass for this shape — so this file
 * produces no node today and the fixture's snapshot says so. It is here because
 * the join is one reading away and the thing it will join on is this.
 */
export const listOrdersFor = (customerId: string) =>
  client.orders.list.query({ customerId });

export const createOrderOf = (sku: string, quantity: number) =>
  client.orders.create.mutate({ sku, quantity });
