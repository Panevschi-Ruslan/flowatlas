import { Hono } from 'hono';

import type { CallbackQuery, StaffBot } from './bot/staff-bot.service';

/**
 * The worker in front of the Nest application. The chat platform posts the
 * staff bot's updates to its webhook, and the worker hands a pressed button to
 * the bot's class.
 */
const app = new Hono();

interface Update {
  callback_query?: CallbackQuery;
}

app.post('/bot/staff/webhook', async (c) => {
  const update = await c.req.json<Update>();
  const container = await boot();
  const bot: StaffBot = container.get('staffBot');
  if (update.callback_query) await bot.handleCallbackQuery(update.callback_query);
  return c.json({ ok: true });
});

/** Plumbing: what a worker does before it can answer anything at all. */
async function boot(): Promise<{ get(key: string): StaffBot }> {
  return { get: () => undefined as unknown as StaffBot };
}

export default app;
