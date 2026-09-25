import { Router, type Request, type Response } from 'express';
import { orders } from '../orders/orders.repository';

/**
 * A router exported by default, which is how most Express repositories write
 * one.
 *
 * The name the importer gives it is its own, and the symbol an importer sees is
 * the export statement rather than this declaration, so both have to arrive at
 * the same node before the mount in `app.ts` can place these routes.
 */
const router = Router();

router.get('/health', (req: Request, res: Response) => res.json({ status: 'ok' }));

// Mounted above every install in `app.ts`, and it reads stored data: nothing in
// front of it can refuse the request, which is what the audit reports.
router.get('/summary', async (req: Request, res: Response): Promise<unknown> => {
  const found = await orders.list();
  return res.json({ count: (found as { rowCount: number }).rowCount });
});

export default router;
