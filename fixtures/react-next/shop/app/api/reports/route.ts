import { listInvoices } from '../../../lib/invoices-store';
import { withAdmin } from '../../../lib/with-admin';

/**
 * One built value bound to a local name and exported under two verbs.
 *
 * Nothing here carries the `export` keyword except the last line, so a rule
 * that looked for the keyword on the declaration said this module declares no
 * function and exports no verb anything could name — while the export table,
 * which is what the framework itself reads, says the module exports two. Both
 * verbs are answered by the one value, so both ways in point at the one node
 * (R74).
 */
const handler = withAdmin(async () => Response.json(await listInvoices()));

export { handler as GET, handler as POST };
