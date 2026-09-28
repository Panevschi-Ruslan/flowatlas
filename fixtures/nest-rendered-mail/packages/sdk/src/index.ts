import { request } from './http.js';

export { SdkProvider } from './SdkProvider.js';

/** What the API calls: one request to the platform. */
export const lookupCustomer = async (email: string): Promise<{ email: string }> =>
  (await request(`/customers/${email}`)).json();
