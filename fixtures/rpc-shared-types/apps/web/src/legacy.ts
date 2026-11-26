import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@shop/router';

/** A link still pointed at the path the tree was served at before it moved to Fastify's /trpc. */
const legacy = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${import.meta.env.VITE_API_URL}/api/trpc` })] });

export function findLegacyOrder(id: string) {
  return legacy.orders.get.query({ id });
}
