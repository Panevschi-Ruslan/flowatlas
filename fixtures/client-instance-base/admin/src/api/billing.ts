import { $fetch } from 'ofetch';

/** The billing service, through `$fetch` made with the setting that names it. */
export const billing = $fetch.create({ baseURL: import.meta.env.VITE_BILLING_URL });
