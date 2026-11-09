import type { AnyRouter } from '@trpc/server';
import { createNextApiHandler as handlerOf } from '@trpc/server/adapters/next';

/**
 * The library's handler, wrapped under its own name so that each file serving
 * a part of the tree is one line: `createNextApiHandler(ordersRouter)`.
 */
export function createNextApiHandler(router: AnyRouter) {
  return handlerOf({ router, batching: { enabled: true } });
}
