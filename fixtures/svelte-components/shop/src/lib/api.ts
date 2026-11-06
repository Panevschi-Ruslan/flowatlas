/** The order list, which the page asks for again on a click. */
export const listOrders = (): Promise<Response> => fetch('/api/orders');
