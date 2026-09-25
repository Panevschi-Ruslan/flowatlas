import { listOrders } from '../../lib/orders-store';

/**
 * The older router, where the file name is the last segment of the address and
 * one handler answers every verb.
 */
export default async function handler(
  _request: unknown,
  response: { json(body: unknown): void },
): Promise<void> {
  response.json(await listOrders());
}
