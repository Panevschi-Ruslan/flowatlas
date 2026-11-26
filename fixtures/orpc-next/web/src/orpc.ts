import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

const link = new RPCLink({ url: `${import.meta.env.VITE_API_URL}/rpc` });

export const client = createORPCClient<any>(link);

export const orpc = createTanstackQueryUtils(client);
