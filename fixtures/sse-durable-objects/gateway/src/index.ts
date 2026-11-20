import { Hono } from 'hono';
import type { Env } from './env';
import type { PresenceMember } from './objects/presence-hub';
import { presenceFor } from './presence';

export { AlertsRelay } from './objects/alerts-relay';
export { BoardFeed } from './objects/board-feed';
export { PresenceHub } from './objects/presence-hub';

const app = new Hono<{ Bindings: Env }>();

// Handed to the board's object, made from an id; the class is the
// configuration's, and its `fetch` streams the channel it subscribes to.
app.get('/boards/:boardId/activity', (c) => {
  const id = c.env.BOARD_FEEDS.idFromName(c.req.param('boardId'));
  return c.env.BOARD_FEEDS.get(id).fetch(c.req.raw);
});

// The presence hub, through a helper that hands back its stub: streamed from
// the writers it holds, which the two routes below write to.
app.get('/boards/:boardId/presence', (c) => presenceFor(c.env, c.req.param('boardId')).fetch(c.req.raw));

app.post('/boards/:boardId/presence', async (c) => {
  await presenceFor(c.env, c.req.param('boardId')).announce(await c.req.json<PresenceMember>());
  return c.json({ ok: true });
});

app.post('/boards/:boardId/presence/leave', async (c) => {
  const stub = presenceFor(c.env, c.req.param('boardId'));
  await stub.fetch(new Request('https://presence/leave', { method: 'POST', body: await c.req.text() }));
  return c.json({ ok: true });
});

// One object for every alert, asked by a stored id with a request made anew.
app.get('/alerts/stream', (c) => c.env.ALERTS.get(c.env.ALERTS.idFromString(c.env.ALERTS_ID)).fetch(new Request(c.req.url, c.req.raw)));

// A class the configuration names and this worker does not declare.
app.get('/boards/:boardId/archive', (c) => c.env.ARCHIVE.get(c.env.ARCHIVE.idFromName(c.req.param('boardId'))).fetch(c.req.raw));

// A class declared by another worker.
app.get('/ledger/stream', (c) => c.env.LEDGER.get(c.env.LEDGER.newUniqueId()).fetch(c.req.raw));

export default app;
