/** An end-to-end helper: skipped, and reported as a skipped test directory. */
export const placeOrder = (): Promise<Response> =>
  fetch('http://localhost:3000/orders', { method: 'POST' });
