import { lazy, os } from '@orpc/server';
import { z } from 'zod';

const Product = z.object({ id: z.string(), name: z.string() });

/**
 * The catalog's procedures, each answered at a REST route of its own by the
 * OpenAPI handler under /api. A plain request to one of those routes hands
 * the procedure the input the handler assembles from it: the path's
 * parameters, with the query of a GET or the body of anything else, or each
 * part under its own key where the route says `detailed`.
 */
export const router = {
  products: {
    get: os
      .route({ method: 'GET', path: '/products/{id}' })
      .input(z.object({ id: z.string() }))
      .output(Product)
      .handler(async ({ input }) => ({ id: input.id, name: 'Green tea' })),
    list: os
      .route({ method: 'GET', path: '/products' })
      .input(z.object({ category: z.string(), limit: z.number() }))
      .output(z.array(Product))
      .handler(async () => []),
    // No route written: POST /api/products/create, its input the body.
    create: os
      .input(z.object({ name: z.string(), price: z.number(), sku: z.string() }))
      .output(z.object({ id: z.string() }))
      .handler(async () => ({ id: 'p-1' })),
    reprice: os
      .route({ method: 'PATCH', path: '/products/{id}/price', inputStructure: 'detailed', outputStructure: 'detailed' })
      .input(z.object({ params: z.object({ id: z.string() }), body: z.object({ price: z.number() }) }))
      .output(z.object({ status: z.number(), body: Product }))
      .handler(async ({ input }) => ({ status: 200, body: { id: input.params.id, name: 'Green tea' } })),
    // Asked with a query built in code (P258).
    search: os
      .route({ method: 'GET', path: '/search' })
      .input(z.object({ q: z.string(), limit: z.string() }))
      .output(z.array(Product))
      .handler(async () => []),
    // The query under `query` and the tenant under `headers`.
    browse: os
      .route({ method: 'GET', path: '/browse', inputStructure: 'detailed' })
      .input(z.object({ query: z.object({ category: z.string(), page: z.string() }), headers: z.object({ 'x-tenant': z.string() }) }))
      .output(z.array(Product))
      .handler(async () => []),
  },
  // Loaded when first asked for, through the alias the Vite configuration declares.
  reports: lazy(() => import('@lib/reports')),
};
