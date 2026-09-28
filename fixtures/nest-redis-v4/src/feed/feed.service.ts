import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

import type { FeedItemAdded } from './feed-events';

/**
 * The three subscription verbs of this transport, in the spelling this client
 * writes them.
 *
 * The package is `redis` and its current major version camel-cases the prefix:
 * `pSubscribe`, `sSubscribe`. A description holding only the lower-case
 * spellings read those two as nothing at all — and invisibly, because a
 * repository that installs a client and never subscribes is ordinary, so the
 * reader found nothing and said nothing (R135). The listener is this call's own
 * argument here rather than a separate `on('message', …)`, which is the other
 * half of the same description.
 */
@Injectable()
export class FeedService {
  private readonly client: RedisClientType = createClient();

  async publish(event: FeedItemAdded): Promise<void> {
    await this.client.publish('feed.item.added', JSON.stringify(event));
  }

  async listen(): Promise<void> {
    // The plain verb, spelled the same by both clients of this transport.
    await this.client.subscribe('feed.item.added', (message) => this.onItem(message));
    // The pattern verb, camel-cased: `channel:feed.moderation.*`.
    await this.client.pSubscribe('feed.moderation.*', (message) => this.onModeration(message));
    // The sharded verb, which is the same sentence a third time.
    await this.client.sSubscribe('feed.shard.updated', (message) => this.onShard(message));
  }

  onItem(message: string): void {
    void message.length;
  }

  onModeration(message: string): void {
    void message.length;
  }

  onShard(message: string): void {
    void message.length;
  }
}
