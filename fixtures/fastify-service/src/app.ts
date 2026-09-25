import fastify from 'fastify';
import { authenticate } from './middleware/hooks';
import { ordersRoutes } from './orders/orders.routes';
import { publicRoutes } from './public/public.routes';

/**
 * The application, and the order everything is installed in.
 *
 * `publicRoutes` is registered above the hook, so nothing in front of those can
 * refuse a request; `ordersRoutes` is registered below it and under a prefix,
 * so every route in that file is served a level down and behind a token.
 */
export const app = fastify();

app.register(publicRoutes, { prefix: '/public' });

app.addHook('onRequest', authenticate);

app.register(ordersRoutes, { prefix: '/orders' });

void app.listen({ port: 3000 });
