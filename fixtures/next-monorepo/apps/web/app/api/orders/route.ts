import { listOrders, saveOrder } from '@next-monorepo/orders-lib';

/**
 * The way in is declared here and the work is done one package away, which is
 * the ordinary shape of a monorepo and the whole point of this fixture.
 */
export async function GET(): Promise<Response> {
  const orders = await listOrders();
  return Response.json(orders);
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  return Response.json(await saveOrder(body));
}
