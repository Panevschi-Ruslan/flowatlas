import { listInvoices } from '../../../../lib/invoices-store';
import { withAdmin } from '../../../../lib/with-admin';

/**
 * A route under a grouping directory, written as a built export.
 *
 * `(admin)` organises the files and adds nothing to the address, so this is
 * served at `/api/invoices`. Reading the directory name as a segment would move
 * every route under it, which is why the group is a rule and not a special case.
 *
 * The verb is a value a call handed back rather than a function this module
 * declares, which is how the ecosystem's larger repositories write every one of
 * their route handlers. The way in was always read — the address and the verb
 * come from where the file is — and until R72 nothing was attached to it, so a
 * flow that reached this route stopped at the boundary instead of carrying on
 * into `listInvoices`.
 */
export const GET = withAdmin(async () => Response.json(await listInvoices()));

/**
 * The same route answered whichever verb the caller uses.
 *
 * An alias of a built export: following the name reaches a declaration that is
 * itself a value a call handed back, which is why the alias is read as a verb
 * in its own right rather than as a name that must already be a function.
 */
export const POST = GET;
