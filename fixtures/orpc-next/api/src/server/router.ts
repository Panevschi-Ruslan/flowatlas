import { lazy, os } from '@orpc/server';
import { audit } from './base';
import { getOrder, listOrders, placeOrder } from './orders';

const section = 'internal';

/**
 * A router is any object whose values are procedures; `os.router` only puts
 * something in front of the ones it is handed, and a prefix on their routes.
 */
export const router = {
  orders: os.use(audit).prefix('/v1').router({ list: listOrders, get: getOrder, place: placeOrder }),
  health: os.handler(async () => ({ ok: true })),
  reports: lazy(() => import('./reports')),
  [section]: { ping: os.handler(async () => 'pong') },
};
