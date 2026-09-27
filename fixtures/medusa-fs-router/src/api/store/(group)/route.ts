import type { MedusaRequest, MedusaResponse } from '@medusajs/framework';

/**
 * A directory in brackets, which this router has no opinion about.
 *
 * This is the assertion that keeps the two file-system routers honest. The other
 * one reads `(group)` as a directory that groups files without appearing in the
 * address, and would serve this at `/store`. This one has no such rule — its
 * parameter matcher is `[...]` and nothing else is special — so the brackets are
 * an ordinary segment and the address is `/store/(group)`.
 *
 * A single shared reading with a per-router list of segment spellings is the only
 * way both of those can be true at once. Two implementations would agree here
 * today and disagree the first time either was touched (R91, R115).
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  res.json({ grouped: false });
};
