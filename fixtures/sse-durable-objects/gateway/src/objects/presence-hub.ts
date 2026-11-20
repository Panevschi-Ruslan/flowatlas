import { DurableObject } from 'cloudflare:workers';
import { frame } from '../bus';
import type { Env } from '../env';

export interface PresenceMember {
  name: string;
}

/**
 * The hub of a board's presence: no broker behind it. Each stream asked of it
 * is held open in `writers`; a method called on its stub (`announce`) and the
 * `/leave` path of its `fetch` write to every one of them.
 */
export class PresenceHub extends DurableObject<Env> {
  private readonly writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/leave') {
      this.send({ type: 'MEMBER_LEFT', member: await request.text() });
      return new Response(null, { status: 204 });
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    this.writers.add(writable.getWriter());
    return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } });
  }

  async announce(member: PresenceMember): Promise<void> {
    this.send({ type: 'MEMBER_JOINED', member: member.name });
  }

  private send(event: { type: string; member: string }): void {
    for (const writer of this.writers) void writer.write(frame(JSON.stringify(event)));
  }
}
