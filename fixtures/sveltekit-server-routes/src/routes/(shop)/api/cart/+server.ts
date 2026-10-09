import { json, type RequestEvent } from '@sveltejs/kit';

/** `(shop)` is a group, so this answers at `/api/cart`. */
export async function POST({ request }: RequestEvent) {
  const line = (await request.json()) as { sku: string; quantity: number };
  return json(line, { status: 201 });
}
