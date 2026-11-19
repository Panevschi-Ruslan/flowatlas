import type { Request, Response } from 'express';

/** Named, so each route has code to point at. */
export const listOrders = (_req: Request, res: Response): void => {
  res.json([{ id: 'order-1' }]);
};

export const placeOrder = (req: Request, res: Response): void => {
  res.status(201).json(req.body);
};
