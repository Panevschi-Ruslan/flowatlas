import type { Request, Response } from 'express';

/** Named, so the route has code to point at and the fixture proves the edge too. */
export const listItems = (_req: Request, res: Response): void => {
  res.json([{ id: 'item-1' }]);
};
