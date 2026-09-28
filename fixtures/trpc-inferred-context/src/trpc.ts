import { initTRPC } from '@trpc/server';
import type { createContextInner } from './context';

export const tRPCContext = initTRPC.context<typeof createContextInner>().create();

export const router = tRPCContext.router;
export const procedure = tRPCContext.procedure;
