import { Router } from 'express';

import { listItems } from './items.controller';

/** A router mounted on the chained application, so its address depends on it. */
export const itemsRouter = Router();

itemsRouter.get('/items', listItems);
