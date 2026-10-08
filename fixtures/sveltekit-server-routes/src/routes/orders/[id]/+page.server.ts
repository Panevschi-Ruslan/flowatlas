import { error, type RequestEvent } from '@sveltejs/kit';
import { oneOrder, removeOrder } from '../../../lib/orders.js';

/** The page's data: its GET, with the param named by the directory. */
export const load = async ({ params }: RequestEvent) => {
  const order = await oneOrder(params.id ?? '');
  if (order === undefined) error(404, 'No such order');
  return { order };
};

/** A form posting to the page with no action named. */
const cancel = async ({ params }: RequestEvent) => {
  await removeOrder(params.id ?? '');
  return { cancelled: true };
};

/** `?/note` is a POST of its own; the default action is the page's POST. */
export const actions = {
  default: cancel,
  note: async ({ request }: RequestEvent) => {
    const form = await request.formData();
    return { note: String(form.get('note') ?? '') };
  },
};
