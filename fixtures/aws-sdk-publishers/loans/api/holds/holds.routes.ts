import { Router, type Request, type Response } from 'express';
import { publishHoldCancelled, publishHoldPlaced, type Hold } from './hold-events';

export const holdsRouter = Router();

export const placeHold = async (req: Request<unknown, unknown, Hold>, res: Response): Promise<unknown> => {
  await publishHoldPlaced(req.body);
  return res.status(202).send();
};

export const cancelHold = async (req: Request<unknown, unknown, Hold>, res: Response): Promise<unknown> => {
  await publishHoldCancelled(req.body);
  return res.status(204).send();
};

holdsRouter.post('/', placeHold);
holdsRouter.post('/cancellations', cancelHold);
