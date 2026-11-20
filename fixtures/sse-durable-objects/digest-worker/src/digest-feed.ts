import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

const encoder = new TextEncoder();

/** The daily digest: every stream asked of it subscribes to the digest's channel. */
export class DigestFeed {
  async fetch(): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const client: RedisClientType = createClient();
    await client.connect();
    await client.subscribe('digest:daily', (message) => {
      void writer.write(encoder.encode(`data: ${message}\n\n`));
    });
    return new Response(readable, { headers: { 'content-type': 'text/event-stream' } });
  }
}
