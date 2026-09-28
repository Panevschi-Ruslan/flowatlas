import type { MedusaRequest, MedusaResponse } from '@medusajs/framework';
import { listOrders } from '../../../services/orders.js';
import { withAdmin } from '../../../utils/with-admin.js';

/**
 * A route declared by where the file is: `src/api/admin/orders` is `/admin/orders`.
 *
 * Nothing in this file says the address, and there is no call anywhere that
 * registers it. The reader is the one shared by every file-system router in this
 * tool, driven by the four values that describe this framework's address space.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  res.json(await listOrders(req.query['q']));
};

/** A verb a wrapper of this repository built, with the work written inside it. */
export const POST = withAdmin(async (req: MedusaRequest, res: MedusaResponse) => {
  res.status(201).json(req.body);
});
