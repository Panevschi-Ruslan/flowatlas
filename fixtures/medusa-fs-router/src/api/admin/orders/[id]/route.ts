import type { MedusaRequest, MedusaResponse } from '@medusajs/framework';
import { oneOrder } from '../../../../services/orders.js';

/** `[id]` is one segment of any value, so this answers at `/admin/orders/:param`. */
export const GET = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  res.json(await oneOrder(req.params['id'] ?? ''));
};

/** A verb written as another verb's name, which is the node the other one has. */
export const HEAD = GET;
