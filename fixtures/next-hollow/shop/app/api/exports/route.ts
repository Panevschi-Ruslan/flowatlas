import { vendorRoutes } from '../../../lib/rest';

/**
 * Two verbs taken out of a table that is a value rather than a call.
 *
 * The spelling that *is* read is `export const { POST } = serve(…)`, where the
 * pattern sits on a call and the call is what the name reaches. Here the pattern
 * sits on a plain name, so there is no call to point at and no function either.
 * Two ways in, two rows.
 */
export const { PUT, DELETE } = vendorRoutes;
