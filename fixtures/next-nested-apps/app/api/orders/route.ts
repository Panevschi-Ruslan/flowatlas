import { listOrders } from '../../../lib/orders-store';

/** The application at the root of the repository, served at its own addresses. */
export async function GET(): Promise<Response> {
  return Response.json(await listOrders());
}
