/**
 * A repository the configuration calls a browser and no adapter claims.
 *
 * Its manifest declares no framework this tool reads, so the reader opens the
 * project, asks the registry which frontend adapters recognise it, is told none,
 * and hands back an empty graph. Everything below is here to be not read: a
 * request with an address in it, which any reader that claimed this repository
 * would have found.
 */
export const loadOrders = async (): Promise<unknown> => {
  const response = await fetch('/api/orders');
  return response.json();
};
