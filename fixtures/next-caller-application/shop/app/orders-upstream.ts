/**
 * A request the server makes to its own service, from the root application.
 *
 * Rooted at a settings key the configuration says is `shop`'s own, so the
 * service asked is the one this file is in, and inside that service the caller's
 * own application is the one it means: the same rule a relative address in the
 * browser gets, applied by the server half of the linker (R136).
 */
export const upstreamOrders = async (): Promise<unknown> => {
  const answer = await fetch(`${process.env.SHOP_URL}/api/orders`);
  return answer.json();
};
