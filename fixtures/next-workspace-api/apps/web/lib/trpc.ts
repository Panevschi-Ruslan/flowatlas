import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@shop/api/routers/_app';

export const trpc = createTRPCReact<AppRouter>();
