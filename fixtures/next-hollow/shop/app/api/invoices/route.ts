import { listInvoices } from '../../../lib/invoices-store';

/**
 * The route that is read in full, next to the ones that are not.
 *
 * Here so that the fixture holds both numbers the summary now prints: a way in
 * with a handler that was read, and four without. It is also the regression
 * guard for the new rows — a handler written in place must never raise one.
 */
export async function GET(): Promise<Response> {
  return Response.json(await listInvoices());
}
