import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { appRouter } from '../server/root';

const client = createTRPCClient<typeof appRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })],
});

/**
 * The other half of the boundary, and the string this fixture is here to pin.
 *
 * `orders.list` is written at the call site verbatim, letter for letter, and it is
 * also the key of the entry point the server half produces. Each call is a
 * request node carrying that path and what the call does — a query, a mutation —
 * read off a proxy the description says `createTRPCClient` makes. Joining the
 * two is the linker's, as it is for every request with an address, so this
 * repository read alone shows the request and not the edge; the join is compared
 * in `fixtures/trpc-join`.
 */
export const listOrdersFor = (customerId: string) =>
  client.orders.list.query({ customerId });

export const createOrderOf = (sku: string, quantity: number) =>
  client.orders.create.mutate({ sku, quantity });
