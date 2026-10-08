import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sendOk } from './respond';
import { store } from './orders.store';
import type { CreateOrder, ImportedOrders, Order, Problem } from './orders.types';

export const ordersRouter = Router();

// The body and the answer stated by the route's own type arguments: read as
// declared, and the answer is what `res.json` is held to.
ordersRouter.post<Record<string, never>, Order, CreateOrder>('/', (req, res) => {
  res.status(201).json(store.add(req.body));
});

// The path params stated on the request; a failure sent with its own shape,
// kept apart from the answer.
ordersRouter.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const found = store.find(req.params.id);
  if (found === undefined) {
    const problem: Problem = { message: 'no such order' };
    res.status(404).json(problem);
    return;
  }
  res.json(found);
});

const UpdateOrder = z.object({ total: z.number(), note: z.string().optional() });

// An untyped body checked by a validator: what it hands back is the shape.
ordersRouter.patch('/:id', (req: Request, res: Response) => {
  const change = UpdateOrder.parse(req.body);
  res.json({ id: String(req.params.id), total: change.total });
});

// An untyped body the handler only says it reads: a cast, which nothing
// checks, recorded as claimed.
ordersRouter.post('/import', (req: Request, res: Response) => {
  const batch = req.body as ImportedOrders;
  res.json({ imported: batch.count });
});

// Nothing stated either way: no body type and an answer of `any`. The route
// is still read, and says that it states nothing.
ordersRouter.get('/', (req: Request, res: Response) => {
  res.json(store.all());
});

const RefundRequest = z.object({ reason: z.string() });

// A body checked without throwing: the shape is what the result holds at
// `data` once it says it succeeded, and the refusal before it is a failure.
ordersRouter.post('/:id/refunds', (req: Request, res: Response) => {
  const result = RefundRequest.safeParse(req.body);
  if (!result.success) {
    const problem: Problem = { message: 'a refund needs a reason' };
    res.status(400).json(problem);
    return;
  }
  res.status(202).json({ id: String(req.params.id), reason: result.data.reason });
});

// An answer built by the project's own helper, which the configuration
// describes: what it is handed is the answer, under the status it always sends.
ordersRouter.get('/:id/summary', (req: Request, res: Response) => {
  const found = store.find(String(req.params.id));
  sendOk(res, { id: String(req.params.id), total: found?.total ?? 0 });
});

// A status worked out at run time: the answer could be either, so it is kept
// apart from both.
ordersRouter.get('/:id/status', (req: Request, res: Response) => {
  const found = store.find(String(req.params.id));
  res.status(found === undefined ? Number(req.query.missing ?? 404) : 200).json({ open: found !== undefined });
});
