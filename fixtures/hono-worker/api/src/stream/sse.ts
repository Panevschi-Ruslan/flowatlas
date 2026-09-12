import type { Context } from 'hono';
import { OrdersService } from '../orders/orders.service';

/**
 * The code behind a stream, as a worker writes it: a function of its own.
 *
 * There is no class between the way in and the work, which is what R12 made
 * readable and what this is the second caller of. The provider is reached by its
 * declared type, so the call resolves without anything being configured.
 */
export async function orderStream(c: Context): Promise<unknown> {
  const orders: OrdersService = c.get('orders');
  const changes = await orders.changesFor(c.req.param('depotId'));
  return c.text(changes);
}

/** The same shape a second time, since both real streams share one function. */
export async function menuStream(c: Context): Promise<unknown> {
  const orders: OrdersService = c.get('orders');
  return c.text(await orders.changesFor(c.req.param('depotId')));
}

/** Named, and reached only through the sub-application mounted below `/api`. */
export async function adminEvents(c: Context): Promise<unknown> {
  const orders: OrdersService = c.get('orders');
  return c.json(await orders.list(c.req.param('depotId')));
}
