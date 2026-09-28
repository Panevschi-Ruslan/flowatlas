import { findOrder, patchOrder } from '../../../../lib/orders-store';

/** A dynamic segment: the directory is the parameter, not anything written here. */
export async function GET(_request: Request, context: { params: { id: string } }): Promise<Response> {
  const order = await findOrder(context.params.id);
  return Response.json(order);
}

/** Written as a constant rather than a declaration, which is a way in all the same. */
export const PATCH = async (
  request: Request,
  context: { params: { id: string } },
): Promise<Response> => {
  const body = await request.json();
  const order = await patchOrder(context.params.id, body);
  return Response.json(order);
};

/**
 * The older spelling of the same route, written as the verb it replaced.
 *
 * The initializer is a name rather than a function or a call, so nothing about
 * this declaration says what answers it; the verb it names does, and both ways
 * in are the same code (R74).
 */
export const PUT = PATCH;
