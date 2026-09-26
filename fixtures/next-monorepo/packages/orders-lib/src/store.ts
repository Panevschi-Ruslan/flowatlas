const orders: unknown[] = [];

/**
 * A setting and a request to somewhere else, both written one package away from
 * the application that reaches them.
 *
 * These two are here because the call edges alone do not prove the body was
 * read: a call target gets a node whether anybody opened its body or not. A
 * setting and an outbound request are found by walking a body, so their presence
 * is the fact that this file is part of the service rather than something the
 * service merely points at.
 */
export const readOrders = async (): Promise<unknown[]> => {
  const upstream = process.env.ORDERS_UPSTREAM_URL;
  if (upstream === undefined) return orders;
  const answer = await fetch(`${upstream}/orders`);
  return answer.json() as Promise<unknown[]>;
};

export const writeOrder = async (order: unknown): Promise<unknown> => {
  orders.push(order);
  return order;
};
