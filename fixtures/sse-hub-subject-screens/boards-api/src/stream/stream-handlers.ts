import type { Context, Handler } from 'hono';

import type { Env } from '../env';

type Ctx = Context<{ Bindings: Env }>;

interface Deps {
  readonly tokens: ReadonlySet<string>;
}

interface Decision {
  readonly ok: boolean;
  readonly boardId?: string;
  readonly scope?: string;
  readonly status?: number;
}

const authorize = async (resolveDeps: () => Promise<Deps>, asked: { token: string; boardId: string }): Promise<Decision> => {
  const deps = await resolveDeps();
  return deps.tokens.has(asked.token) ? { ok: true, boardId: asked.boardId, scope: `board:${asked.boardId}` } : { ok: false, status: 401 };
};

/** Hands a stream asked for to the board's hub, on its `/subscribe` branch. */
const forwardToHub = (c: Ctx, decision: Decision): Response | Promise<Response> => {
  if (!decision.ok) return c.json({ error: 'unauthorized' }, decision.status);
  const stub = c.env.BOARD_HUB.get(c.env.BOARD_HUB.idFromName(decision.boardId));
  return stub.fetch(`https://hub.local/subscribe?scope=${decision.scope}`, { method: 'GET' });
};

/**
 * The stream routes' handlers, made by a factory and handed to the router as
 * members of the object it returns: one written as `key: value`, one as a
 * shorthand.
 */
export const createStreamHandlers = (resolveDeps: () => Promise<Deps>) => {
  const boardEvents: Handler<{ Bindings: Env }> = async (c) =>
    forwardToHub(c, await authorize(resolveDeps, { token: c.req.query('token') ?? '', boardId: c.req.param('boardId') }));

  const ping: Handler<{ Bindings: Env }> = (c) => c.json({ ok: true });

  const crewStream: Handler<{ Bindings: Env }> = async (c) =>
    forwardToHub(c, await authorize(resolveDeps, { token: c.req.query('token') ?? '', boardId: c.req.param('boardId') }));

  return { boardEvents, stream: boardEvents, crewStream, health: ping };
};
