/**
 * A caller inside the application at the root of the repository.
 *
 * `/api/orders` is a relative address, so it means the application this file is
 * part of and no other: the browser asks the origin the page came from. Two
 * applications here declare that address, and which of them this one reaches is
 * not a deployment question — it is the application the file is written in.
 */
export const loadOrders = async (): Promise<unknown> => {
  const response = await fetch('/api/orders');
  return response.json();
};
