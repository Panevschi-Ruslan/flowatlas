import { Router, type Request, type Response } from 'express';

/**
 * The routes, written without the segment they are served under.
 *
 * Every path here is relative to wherever the router is mounted, which is the
 * whole point: the router does not know it is under `/api` and nothing in this
 * file says so. The mount next door is the only place that fact is written.
 */
export const documentsRouter = Router();

documentsRouter.post('/documents.info', async (req: Request, res: Response): Promise<unknown> =>
  res.json({ id: req.body.id }),
);

documentsRouter.post('/documents.update', async (req: Request, res: Response): Promise<unknown> =>
  res.json({ id: req.body.id, title: req.body.title }),
);
