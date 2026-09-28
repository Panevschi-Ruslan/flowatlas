import type { Request, Response } from 'express';

/** Answers both addresses of the list, so one function is behind two entries. */
export const listItems = (_req: Request, res: Response): void => {
  res.json([{ id: 'item-1' }]);
};

/** Answers both spellings of one item's address. */
export const showItem = (req: Request, res: Response): void => {
  res.json({ id: req.params.id });
};
