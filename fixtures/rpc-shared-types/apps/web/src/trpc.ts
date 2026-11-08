import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@shop/router';

/** Typed from the router type the shared package exports, which is the server's own tree. */
export const trpc = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${import.meta.env.VITE_API_URL}/trpc` })] });
