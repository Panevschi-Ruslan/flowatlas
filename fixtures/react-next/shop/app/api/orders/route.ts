import { listOrders, saveOrder } from '../../../lib/orders-store';

/** Two verbs exported from one file, which is two ways in at one address. */
export async function GET(): Promise<Response> {
  const orders = await listOrders();
  return Response.json(orders);
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  const saved = await saveOrder(body);
  return Response.json(saved);
}
