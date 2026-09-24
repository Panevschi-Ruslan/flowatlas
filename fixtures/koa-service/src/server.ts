import Koa from 'koa';
import { authenticate } from './middleware/guards';
import { ordersRouter } from './orders/orders.routes';
import { publicRouter } from './public/public.routes';

/**
 * The application, and the order everything is installed in.
 *
 * A Koa router is installed as the middleware it turns itself into, and twice:
 * once for its routes and once for the methods it answers. Both are the same
 * router arriving at the same place, and an application asked for its base
 * twice must answer twice rather than call the second time a cycle.
 */
const app = new Koa();

app.use(publicRouter.routes()).use(publicRouter.allowedMethods());

app.use(authenticate);

app.use(ordersRouter.routes()).use(ordersRouter.allowedMethods());

app.listen(3000);
