/**
 * The same call, written in the other application.
 *
 * The address is the same string and the answer is a different entry, because
 * the request records which application its call site belongs to (R132).
 */
export const loadOrders = async (): Promise<unknown> => {
  const response = await fetch('/api/orders');
  return response.json();
};
