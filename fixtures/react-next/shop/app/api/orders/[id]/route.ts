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
