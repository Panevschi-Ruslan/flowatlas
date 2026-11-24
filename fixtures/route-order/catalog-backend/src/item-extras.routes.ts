import { Router, type Request, type Response } from 'express';

export const itemExtrasRouter = Router();

export const listNewest = (_req: Request, res: Response): void => {
  res.json([]);
};

itemExtrasRouter.get('/new', listNewest);
