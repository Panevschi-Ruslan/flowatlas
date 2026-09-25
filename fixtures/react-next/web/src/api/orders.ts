/**
 * The module of plain functions a React repository keeps its requests in.
 *
 * No class, no injection, nothing the compiler can be asked about: the address
 * is a template rooted at a settings value the bundler swaps out, and what
 * encloses it is an exported arrow.
 */
const base = import.meta.env.VITE_API_URL;

export interface OrderDto {
  id: string;
  name: string;
  archived: boolean;
}

export interface UpdateOrderDto {
  name: string;
}

export const listOrders = async (): Promise<OrderDto[]> => {
  const answer = await fetch(`${base}/api/orders`);
  return answer.json();
};

export const updateOrder = async (id: string, patch: UpdateOrderDto): Promise<OrderDto> => {
  const answer = await fetch(`${base}/api/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return answer.json();
};

/**
 * A request whose address is decided one call away.
 *
 * The wrapper writes the root and the caller writes the tail, so nothing here
 * is a readable address; it becomes one at `listInvoices` below, which is where
 * the request is attributed.
 */
const send = async (path: string): Promise<unknown> => {
  const answer = await fetch(`${base}${path}`);
  return answer.json();
};

export const listInvoices = async (): Promise<unknown> => send('/api/invoices');
