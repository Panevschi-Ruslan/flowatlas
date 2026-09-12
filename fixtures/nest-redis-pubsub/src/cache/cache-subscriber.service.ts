import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { CacheInvalidated } from './cache-events';

/**
 * Consumers. Redis pub/sub has no decorator, so the consumer is found by pairing
 * a `subscribe(channel)` call with the `on('message', ...)` listener on the same
 * connection — which is why each subscription gets its own client, as the real
 * library requires once a connection enters subscriber mode.
 */
@Injectable()
export class CacheSubscriberService implements OnModuleInit {
  private readonly invalidations = new Redis({ host: 'localhost', port: 6379 });
  private readonly raw = new Redis({ host: 'localhost', port: 6379 });

  async onModuleInit(): Promise<void> {
    // The listener body delegates to exactly one method, so the consumer lands
    // on `handleInvalidation` — not on `onModuleInit`, and not on the arrow.
    // Expected: `consumer` on `CacheSubscriberService.handleInvalidation`,
    // `channel:cache.invalidate`, static.
    await this.invalidations.subscribe('cache.invalidate');
    this.invalidations.on('message', (channel, message) => this.handleInvalidation(message));

    // The listener body does more than delegate, so there is no single handler
    // to point at and the consumer falls back to the enclosing method.
    // Expected: `consumer` on `CacheSubscriberService.onModuleInit`,
    // `channel:cache.raw`, heuristic, unresolved `consumer-handler-unresolved`.
    await this.raw.subscribe('cache.raw');
    this.raw.on('message', (channel, message) => {
      this.audit(channel, message);
      this.handleRaw(message);
    });
  }

  /** The one method the first listener delegates to. */
  handleInvalidation(message: string): void {
    const event = JSON.parse(message) as CacheInvalidated;
    void event.id;
  }

  private audit(channel: string, message: string): void {
    void channel;
    void message.length;
  }

  private handleRaw(message: string): void {
    void message.length;
  }
}
