/** The order requests every screen makes. */
export const place = (name: string): Promise<Response> =>
  fetch('/api/orders', { method: 'POST', body: JSON.stringify({ name }) });

export const cancel = (id: string): Promise<Response> => fetch(`/api/orders/${id}`, { method: 'DELETE' });
