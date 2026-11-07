import { oc } from '@orpc/contract';
import { z } from 'zod';

const Order = z.object({ id: z.string(), sku: z.string(), quantity: z.number() });

/**
 * What the service promises, written before any of it is implemented: each
 * procedure's route, what it is sent, what it answers and how it may fail.
 * Nothing here runs.
 */
export const contract = {
  orders: oc.prefix('/shop').router({
    list: oc.route({ method: 'GET', path: '/orders' }).input(z.object({ sku: z.string().optional() })).output(z.array(Order)),
    cancel: oc
      .route({ method: 'DELETE', path: '/orders/{id}' })
      .input(z.object({ id: z.string() }))
      .errors({ NOT_FOUND: {}, ALREADY_SHIPPED: { status: 409 } }),
  }),
};
