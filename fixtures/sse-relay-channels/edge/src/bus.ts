import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * A helper of the worker's own: it subscribes to the channel it is handed. A
 * function rather than a method, so nothing about a class is there to read.
 */
export async function listen(channel: string, onMessage: (message: string) => void): Promise<void> {
  const client: RedisClientType = createClient();
  await client.connect();
  await client.subscribe(channel, onMessage);
}
