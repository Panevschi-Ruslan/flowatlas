import ky from 'ky';

import { BILLING_HOST } from '../config';

/**
 * The invoices client: every request is replaced by one at the billing host,
 * keeping the path it was made under.
 */
export const invoicesApi = ky.create({
  timeout: 5000,
  hooks: {
    beforeRequest: [(request) => new Request(`${BILLING_HOST}${new URL(request.url).pathname}`, request)],
  },
});
