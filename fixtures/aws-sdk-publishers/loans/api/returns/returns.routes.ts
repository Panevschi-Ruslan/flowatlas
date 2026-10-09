import { Router, type Request, type Response } from 'express';
import { LibraryEvent, libraryEvents } from '../events/library-events';
import { queueOverdue, queueReturn, queueReturns, type ReturnedItem } from './returns-queue';

export const returnsRouter = Router();

export const returnItem = async (req: Request<unknown, unknown, ReturnedItem>, res: Response): Promise<unknown> => {
  const item = req.body;
  await queueReturn(item);
  await libraryEvents.put(new LibraryEvent({ type: 'ItemReturned', detail: item }));
  return res.status(202).send();
};

export const returnItems = async (req: Request<unknown, unknown, ReturnedItem[]>, res: Response): Promise<unknown> => {
  await queueReturns(req.body);
  return res.status(202).send();
};

export const returnOverdue = async (req: Request<unknown, unknown, ReturnedItem>, res: Response): Promise<unknown> => {
  await queueOverdue(req.body);
  return res.status(202).send();
};

returnsRouter.post('/', returnItem);
returnsRouter.post('/batch', returnItems);
returnsRouter.post('/overdue', returnOverdue);
