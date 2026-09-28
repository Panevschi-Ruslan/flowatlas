/**
 * The API's own end-to-end helper. It calls the API from outside, as a test
 * does, and it is server code: nothing here runs in a browser.
 */
export const placeOrder = async (email: string): Promise<Response> =>
  fetch(`${process.env.E2E_API_URL}/orders`, {
    method: 'POST',
    body: JSON.stringify({ id: 'o-1', email }),
  });
