import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/node';
import { oneOrder, removeOrder } from '../models/orders.js';

/** `$orderId` is a param: `/api/orders/:orderId`. A loader may return the value itself. */
export async function loader({ params }: LoaderFunctionArgs) {
  return oneOrder(params.orderId ?? '');
}

/**
 * One action answering two verbs, which it says by comparing the method: a
 * DELETE and a PUT, not the POST a form would send (P43).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method === 'DELETE') {
    await removeOrder(params.orderId ?? '');
    return json(null, { status: 204 });
  }
  switch (request.method) {
    case 'PUT':
      return json(await oneOrder(params.orderId ?? ''));
    default:
      return json({ error: 'method' }, { status: 405 });
  }
}
