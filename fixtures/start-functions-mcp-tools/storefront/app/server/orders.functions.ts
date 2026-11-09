import { createServerFn } from '@tanstack/react-start';
import { requireSession } from './auth';

interface PlaceOrder {
  sku: string;
  quantity: number;
}

/** Sent with GET, the library's default, since the options name no verb. */
export const listOrders = createServerFn().handler(async () => [{ id: 'o-1', total: 12 }]);

/** Sent with POST, behind the session middleware, its input checked first. */
export const placeOrder = createServerFn({ method: 'POST' })
  .middleware([requireSession])
  .validator((data: PlaceOrder): PlaceOrder => data)
  .handler(async ({ data }) => ({ id: 'o-2', ...data }));

async function archiveOldOrders(): Promise<{ archived: number }> {
  return { archived: 0 };
}

/** Kept to this module and handed a function declared beside it. */
const archiveOrders = createServerFn({ method: 'POST' }).handler(archiveOldOrders);

export const archiveNow = async (): Promise<{ archived: number }> => archiveOrders();

/** Made inside an object, so nothing names what the browser would import: a row. */
export const refunds = {
  issue: createServerFn({ method: 'POST' }).handler(async () => ({ refunded: true })),
};
