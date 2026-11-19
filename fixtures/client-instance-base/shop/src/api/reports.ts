import { ofetch } from 'ofetch';

/** Billing's reports, through a client made with the setting that names billing. */
export const reports = ofetch.create({ baseURL: import.meta.env.VITE_BILLING_URL });
