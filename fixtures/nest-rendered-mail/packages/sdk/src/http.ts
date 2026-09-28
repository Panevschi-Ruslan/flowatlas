/** The SDK's transport, called from the API's request handler. */
export const request = async (path: string): Promise<Response> =>
  fetch(`${process.env.PLATFORM_URL}${path}`, { method: 'GET' });
