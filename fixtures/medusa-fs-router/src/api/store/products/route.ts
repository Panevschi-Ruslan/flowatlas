import type { MedusaRequest, MedusaResponse } from '@medusajs/framework';
import { listProducts } from '../../../services/products.js';

/**
 * A route the declarative middleware list names, for `GET` only.
 *
 * What the list says about this address is the whole of what this reader knows
 * about what stands in front of it, and `POST /store/products` is deliberately
 * outside the entry's verbs so that the two rows differ.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  res.json(await listProducts());
};

export const POST = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  res.status(201).json(req.body);
};
