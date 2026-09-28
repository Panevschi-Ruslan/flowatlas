import type { MedusaRequest, MedusaResponse } from '@medusajs/framework';

/**
 * A file the router refuses to serve, because a segment of its path starts with
 * an underscore.
 *
 * This is the one segment spelling the two file-system routers here agree on,
 * and they arrived at it independently. There must be no entry for this file at
 * any address.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  res.json({ ok: true });
};
