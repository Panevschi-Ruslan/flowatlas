import Koa from 'koa';
import { ordersRouter } from './orders.routes';

/** Where the router is installed, which is the only thing the application says. */
export const app = new Koa();

app.use(ordersRouter.routes()).use(ordersRouter.allowedMethods());
