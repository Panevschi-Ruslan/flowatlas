import type { Env } from './env';

/** The stub of a board's presence hub: the helper every route asks it through. */
export function presenceFor(env: Env, boardId: string) {
  return env.PRESENCE.getByName(boardId);
}
