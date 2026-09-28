/**
 * The same request, written inside the second application.
 *
 * The same string as the root application's, and a different entry: both
 * applications declare `/api/orders`, and a caller inside one of them means its
 * own. Before R136 the server's reading of this call carried no application, so
 * the linker named both and chose neither.
 */
export const upstreamOrders = async (): Promise<unknown> => {
  const answer = await fetch(`${process.env.SHOP_URL}/api/orders`);
  return answer.json();
};
