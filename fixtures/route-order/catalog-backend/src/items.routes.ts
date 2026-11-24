import { Router, type Request, type Response } from 'express';

export const itemsRouter = Router();

export const showItem = (req: Request, res: Response): void => {
  res.json({ id: req.params['itemId'] });
};

export const listFeatured = (_req: Request, res: Response): void => {
  res.json([]);
};

itemsRouter.get('/:itemId', showItem);

// Registered after `/:itemId` on the same router, which answers `/items/featured` first.
itemsRouter.get('/featured', listFeatured);
