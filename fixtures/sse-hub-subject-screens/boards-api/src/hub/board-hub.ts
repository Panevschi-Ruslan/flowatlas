import type { Env } from '../env';

type Writer = WritableStreamDefaultWriter<Uint8Array>;

interface Subscriber {
  readonly scope: string;
}

const encoder = new TextEncoder();

const frame = (message: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(message)}\n\n`);

/** Whether a channel is one the subscriber's scope covers: `board:<id>:events` for the board `<id>`. */
const inScope = (subscriber: Subscriber, channel: string): boolean => channel.startsWith(`${subscriber.scope}:`);

/**
 * One object per board. It subscribes to no broker: whatever is published
 * through the project's bus is posted to `/publish`, and it writes that to
 * every stream held open through `/subscribe` whose scope covers the channel.
 * So it relays every channel the bus hands it, by name.
 */
export class BoardHub {
  private readonly subscribers = new Map<Writer, Subscriber>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publish') {
      const { channel, message } = (await request.json()) as { channel: string; message: unknown };
      for (const [writer, subscriber] of this.subscribers) {
        if (inScope(subscriber, channel)) void writer.write(frame(message));
      }
      return new Response(null, { status: 204 });
    }
    if (request.method === 'GET' && url.pathname === '/subscribe') {
      const scope = url.searchParams.get('scope') ?? '';
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      this.subscribers.set(writable.getWriter(), { scope });
      return new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    }
    return new Response('not found', { status: 404 });
  }
}
