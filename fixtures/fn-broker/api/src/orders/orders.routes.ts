import { Router, type Request, type Response } from 'express';

import { bus } from '../bus/event-bus';
import { invoices, notifyCreated } from './notify';
import { OrdersService } from './orders.service';

export const ordersRouter = Router();

const orders = new OrdersService(bus);

// A handler written in the registration itself. It is nobody's module-level
// function and it is the shape a Next.js route or an Express route keeps most
// of its work in, so a publish here is the case the old walk could never reach.
ordersRouter.post('/:orderId/cancel', (req: Request, res: Response): unknown => {
  bus.publish('orders:cancelled', { orderId: req.params['orderId'] as string, total: 0 });
  return res.status(202).send();
});

ordersRouter.post('/', (req: Request, res: Response): unknown => {
  const event = { orderId: 'order-1', total: 10 };
  orders.publishCreated(event);
  notifyCreated(event);
  invoices.notifyInvoiced(event);
  return res.status(201).send();
});
