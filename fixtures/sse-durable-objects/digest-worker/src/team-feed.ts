import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

const encoder = new TextEncoder();

/** One object per team, named by the team: it streams the team's channel. */
export class TeamFeed {
  async fetch(request: Request): Promise<Response> {
    const teamId = new URL(request.url).pathname.split('/')[2];
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const client: RedisClientType = createClient();
    await client.connect();
    await client.subscribe(`team:${teamId}:feed`, (message) => {
      void writer.write(encoder.encode(`data: ${message}\n\n`));
    });
    return new Response(readable, { headers: { 'content-type': 'text/event-stream' } });
  }
}
