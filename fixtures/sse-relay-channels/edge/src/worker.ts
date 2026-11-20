import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { listen } from './bus';

/** A namespace of objects of one per room, which the request is handed to. */
interface RoomObjects {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

const app = new Hono<{ Bindings: { ROOMS: RoomObjects } }>();

// The stream written by the route itself, fed by a subscription made through
// the helper: the channel is read where this route hands it over.
app.get('/live/:workspaceId', (c) =>
  streamSSE(c, async (stream) => {
    await listen(`workspace:${c.req.param('workspaceId')}:events`, (message) => {
      void stream.writeSSE({ data: message });
    });
  }),
);

// The stream answered by an object the request is handed to, which nothing
// binds to a class (P361): what it relays is code this route does not hold.
app.get('/rooms/:roomId/stream', (c) => {
  const id = c.env.ROOMS.idFromName(c.req.param('roomId'));
  return c.env.ROOMS.get(id).fetch(c.req.raw);
});

export default app;
