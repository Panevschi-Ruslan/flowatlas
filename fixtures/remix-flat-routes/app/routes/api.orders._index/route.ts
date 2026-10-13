import { json, type ActionFunctionArgs } from '@remix-run/node';
import { createOrder, listOrders } from '../../models/orders.js';

/** A folder named flat, holding its route file: `/api/orders`. */
export const loader = async () => json(await listOrders());

export async function action({ request }: ActionFunctionArgs) {
  const form = (await request.json()) as { total: number };
  return json(await createOrder(form.total), { status: 201 });
}
