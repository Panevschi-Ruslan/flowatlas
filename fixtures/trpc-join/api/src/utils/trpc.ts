import { createTRPCReact } from '@trpc/react-query';
import type { appRouter } from '../server/root';

export const trpc = createTRPCReact<typeof appRouter>();
