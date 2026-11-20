import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** A helper of the worker's own: it subscribes to the channel it is handed. */
export async function listen(channel: string, onMessage: (message: string) => void): Promise<void> {
  const client: RedisClientType = createClient();
  await client.connect();
  await client.subscribe(channel, onMessage);
}

export const encoder = new TextEncoder();

/** One frame of a stream of server-sent events. */
export const frame = (message: string): Uint8Array => encoder.encode(`data: ${message}\n\n`);
