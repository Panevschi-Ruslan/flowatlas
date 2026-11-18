import { Router } from 'express';

import { listOrders, placeOrder } from './orders.controller';

/** `Router()` imported from `express` itself, held by a `const`: the value, made right here. */
export const ordersRouter = Router();

ordersRouter.get('/', listOrders);
ordersRouter.post('/', placeOrder);
