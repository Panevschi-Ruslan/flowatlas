import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/authenticate';
import { withTenant } from '../middleware/with-tenant';
import { listOrders } from './orders.controller';
import { orders } from './orders.repository';

/** What a request may carry, where the route says so and only there. */
export interface CreateOrder {
  total: number;
  note?: string;
}

export const ordersRouter = Router();

// Installed on the router, so it covers every route declared below it and
// nothing declared above it. There is nothing above it here, which is the
// ordinary way this is written.
ordersRouter.use(withTenant);

// A handler named elsewhere and registered by name.
ordersRouter.get('/', listOrders);

// A handler written in the registration. The route is still a way in; what is
// missing is only a name to point at as the code behind it.
ordersRouter.get('/:orderId', async (req: Request, res: Response): Promise<unknown> => {
  const order = await orders.byId(req.params['orderId'] as string);
  return res.json(order);
});

// Middleware between the path and the handler, and a body with a declared
// shape — which most Express handlers do not have, and this one only has
// because the route says so.
ordersRouter.post(
  '/',
  requireAdmin,
  async (req: Request<unknown, unknown, CreateOrder>, res: Response): Promise<unknown> => {
    await orders.insert(req.body.total);
    return res.status(201).send();
  },
);

const archivePath = (name: string): string => `/${name}/archive`;

// A path assembled at run time: no route to record, and a row saying so.
ordersRouter.delete(archivePath('old'), (req: Request, res: Response) => res.status(204).send());
