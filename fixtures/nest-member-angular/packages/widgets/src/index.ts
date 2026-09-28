export { StatusService } from './status.service.js';

/** The one thing the API takes from this package: plain data. */
export const STATUS_LABELS = { placed: 'Placed', paid: 'Paid' } as const;
