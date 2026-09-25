import { listInvoices } from '../../../../lib/invoices-store';

/**
 * A route under a grouping directory.
 *
 * `(admin)` organises the files and adds nothing to the address, so this is
 * served at `/api/invoices`. Reading the directory name as a segment would move
 * every route under it, which is why the group is a rule and not a special case.
 */
export async function GET(): Promise<Response> {
  return Response.json(await listInvoices());
}
