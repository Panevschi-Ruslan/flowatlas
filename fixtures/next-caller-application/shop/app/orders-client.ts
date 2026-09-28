/**
 * A request written in the root application.
 *
 * Relative, so it asks the origin this file was served from, which is this
 * application and not the one under `examples/`.
 */
export const listOrders = async (): Promise<unknown> => {
  const answer = await fetch('/api/orders');
  return answer.json();
};
