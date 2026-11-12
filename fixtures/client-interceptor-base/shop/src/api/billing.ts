import { ofetch } from 'ofetch';

/** The billing client: its hook sets the base before every request. */
export const billingApi = ofetch.create({
  onRequest({ options }) {
    options.baseURL = import.meta.env.VITE_BILLING_URL;
  },
});
