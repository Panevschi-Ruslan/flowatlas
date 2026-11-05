import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

/** A link whose address is worked out for every request: nothing says where it sends. */
const fromRunTime = createORPCClient<any>(new RPCLink({ url: () => `${window.location.origin}/rpc` }));

/** A link pointed at the OpenAPI prefix, where the RPC protocol is not answered. */
const misplaced = createORPCClient<any>(new RPCLink({ url: `${import.meta.env.VITE_API_URL}/api` }));

export const health = () => fromRunTime.health();

export const legacyOrders = () => misplaced.orders.list({});
