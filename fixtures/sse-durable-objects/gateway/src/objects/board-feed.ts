import { frame, listen } from '../bus';
import type { Env } from '../env';

/**
 * One object per board, written without the platform's base class. Its
 * `fetch` tells two paths apart: the board's activity, streamed from the
 * channel it subscribes to, and anything else, which it refuses.
 */
export class BoardFeed {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/activity')) {
      const boardId = url.pathname.split('/')[2];
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      await listen(`board:${boardId}:activity`, (message) => {
        void writer.write(frame(message));
      });
      return new Response(readable, { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('not found', { status: 404 });
  }
}
