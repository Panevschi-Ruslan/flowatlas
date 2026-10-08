import type { LoaderFunctionArgs } from '@remix-run/node';
import { oneOrder } from '../models/orders.js';

/** `$orderId` is a param: `/api/orders/:orderId`. A loader may return the value itself. */
export async function loader({ params }: LoaderFunctionArgs) {
  return oneOrder(params.orderId ?? '');
}
