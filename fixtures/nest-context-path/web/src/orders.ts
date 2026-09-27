/**
 * Three requests, written relative to a base that already carries the mount.
 *
 * The first two are addresses the api serves behind the part of its own
 * address nobody could read. The third is served by nothing at all, and is here
 * so that the plain sentence is still said where it is true.
 */
export const listOrders = (): Promise<Response> => fetch('/v1/orders');

export const readOrder = (id: string): Promise<Response> => fetch(`/v1/orders/${id}`);

export const listInvoices = (): Promise<Response> => fetch('/v1/invoices');
