const deliveries: unknown[] = [];

/**
 * A setting and a request out of the process, one package away from the
 * application that reaches them.
 *
 * These are what prove the handler's body was walked rather than only named: a
 * call target gets a node either way, and a setting and an outbound call are
 * found only by reading a body.
 */
export const recordDelivery = async (delivery: unknown): Promise<unknown> => {
  const upstream = process.env.DELIVERIES_UPSTREAM_URL;
  deliveries.push(delivery);
  if (upstream === undefined) return delivery;
  const answer = await fetch(`${upstream}/deliveries`, { method: 'POST' });
  return answer.json();
};
