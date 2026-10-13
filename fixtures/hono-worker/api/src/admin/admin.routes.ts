import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { adminEvents } from '../stream/sse';

/** What the admin panel sends to change a note. */
interface NoteChange {
  text: string;
}

/**
 * A sub-application, mounted by the worker rather than served on its own.
 *
 * Its routes are declared here at `/events`, one file and one import away from
 * the `route('/api/admin', …)` that decides where they are answered. Reading the
 * declaration alone would put both of them at the wrong address.
 */
export const adminRoutes = new Hono();

adminRoutes.get('/events', adminEvents);

adminRoutes.get('/orders/:orderId', (c) => c.json({ id: c.req.param('orderId') }));

// What a route reads, said by the validator in front of it: the handler is
// handed what the schema checked, and that is the body's shape.
const NoteSchema = z.object({ text: z.string(), pinned: z.boolean() });

adminRoutes.post('/notes', zValidator('json', NoteSchema), (c) => {
  const note = c.req.valid('json');
  return c.json({ id: 'n1', text: note.text }, 201);
});

// What a route only says it reads: a type argument nothing checks.
adminRoutes.put('/notes/:noteId', async (c) => {
  const change = await c.req.json<NoteChange>();
  return c.json({ id: c.req.param('noteId'), text: change.text });
});
