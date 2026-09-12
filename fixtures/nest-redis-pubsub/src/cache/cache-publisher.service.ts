import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { CACHE_CHANNELS } from './cache-events';
import type { CacheInvalidated, CacheWarmed } from './cache-events';

/**
 * Producers. `redis.publish(channel, message)` is `meta.kind: "message"` with
 * `meta.channelKind: "channel"`; the payload type is the type of the value being
 * serialised, not of the string handed to redis.
 */
@Injectable()
export class CachePublisherService {
  private readonly redis = new Redis({ host: 'localhost', port: 6379 });

  // The canonical row: literal channel, payload read through `JSON.stringify`.
  // Expected: `channel:cache.invalidate`, static, payload `CacheInvalidated`.
  invalidate(event: CacheInvalidated): Promise<number> {
    return this.redis.publish('cache.invalidate', JSON.stringify(event));
  }

  // The channel comes from an `as const` object in this repo (step 2).
  // Expected: `channel:cache.warm`, static, `meta.channelVia: "const"`.
  warm(event: CacheWarmed): Promise<number> {
    return this.redis.publish(CACHE_CHANNELS.warm, JSON.stringify(event));
  }

  // A second producer on `cache.invalidate`, this time from inside an arrow
  // passed to `.then()`: it is attributed to `invalidateAll`, the enclosing
  // method declaration, never to the arrow (§10).
  invalidateAll(events: CacheInvalidated[]): void {
    void Promise.resolve(events).then((batch) => {
      for (const event of batch) {
        this.redis.publish('cache.invalidate', JSON.stringify(event));
      }
    });
  }

  // The payload arrives untyped from a caller outside the repo, so there is no
  // type to put on the `emits` edge.
  // Expected: `channel:cache.raw` static, unresolved `payload-type-unknown`.
  forward(raw: any): Promise<number> {
    return this.redis.publish('cache.raw', JSON.stringify(raw));
  }

  // The channel is a parameter.
  // Expected: `producer` with no channel, unresolved `channel-dynamic`, hint
  // naming `CachePublisherService.publishTo`.
  publishTo(channel: string, event: CacheInvalidated): Promise<number> {
    return this.redis.publish(channel, JSON.stringify(event));
  }
}
