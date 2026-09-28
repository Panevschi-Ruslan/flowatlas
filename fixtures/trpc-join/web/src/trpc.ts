import { createTRPCReact } from '@trpc/react-query';
import { createTRPCContext } from '@trpc/tanstack-react-query';

/**
 * Two proxies, one per binding. The type argument would be the server's tree in a
 * real repository, imported from the other service; here it is `any`, which is
 * the state a clone nobody installed is in, and the reading has to hold up in it.
 */
export const trpc = createTRPCReact<any>();

export const { TRPCProvider, useTRPC } = createTRPCContext<any>();
