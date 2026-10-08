import { json, type RequestEvent } from '@sveltejs/kit';
import { oneOrder, removeOrder } from '../../../../lib/orders.js';

/** `[id=integer]` is a param named `id`; the matcher is no part of its name. */
export async function GET({ params }: RequestEvent) {
  return json(await oneOrder(params.id ?? ''));
}

export async function DELETE({ params }: RequestEvent) {
  await removeOrder(params.id ?? '');
  return json(null, { status: 204 });
}
