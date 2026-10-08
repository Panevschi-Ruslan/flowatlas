import Koa from 'koa';
import Router from '@koa/router';

export interface AddLine {
  sku: string;
  quantity: number;
}

export interface Cart {
  id: string;
  lines: AddLine[];
}

const router = new Router({ prefix: '/carts' });

// The body only cast, which nothing checks; the answer assigned to the
// context is a declared shape.
router.post('/:id/lines', async (ctx) => {
  const line = ctx.request.body as AddLine;
  const cart: Cart = { id: ctx.params.id ?? 'c1', lines: [line] };
  ctx.status = 201;
  ctx.body = cart;
});

// Nothing read and nothing typed: the route says so by saying nothing.
router.get('/:id', async (ctx) => {
  ctx.body = JSON.parse('{}');
});

const app = new Koa();
app.use(router.routes());
app.listen(3002);
