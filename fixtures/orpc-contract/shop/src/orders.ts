import { contract } from '@acme/orders-contract';
import { createORPCClient } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';

/** A client typed by the contract alone, sending to the REST routes the OpenAPI handler answers. */
const client = createORPCClient<any>(new OpenAPILink(contract, { url: `${import.meta.env.VITE_ORDERS_URL}/api` }));

export const listOrders = (sku?: string) => client.orders.list({ sku });

export const cancelOrder = (id: string) => client.orders.cancel({ id });

/** The same procedure reached by its route, written out by hand. */
export const cancelByRoute = (id: string) =>
  fetch(`${import.meta.env.VITE_ORDERS_URL}/api/shop/orders/${id}`, { method: 'DELETE' });
