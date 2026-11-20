import { DurableObject } from 'cloudflare:workers';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { frame } from '../bus';
import type { Env } from '../env';

/**
 * One object for every alert: the subscription is opened once, in the
 * constructor, and each message is fanned out to the streams held in
 * `streams`, which `fetch` adds to.
 */
export class AlertsRelay extends DurableObject<Env> {
  private readonly streams: WritableStreamDefaultWriter<Uint8Array>[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const client: RedisClientType = createClient({ url: env.REDIS_URL });
      await client.connect();
      await client.subscribe('alerts:global', (message) => this.fanOut(message));
    });
  }

  async fetch(): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    this.streams.push(writable.getWriter());
    return new Response(readable, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  }

  fanOut(message: string): void {
    for (const stream of this.streams) void stream.write(frame(message));
  }
}
