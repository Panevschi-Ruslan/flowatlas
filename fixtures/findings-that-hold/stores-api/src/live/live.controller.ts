import { Controller, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * The streams the shop's screens hold open.
 *
 * `stream` relays both of the shop's channels, its orders and its events, so
 * a screen on it receives a type published on either. `feed` relays the
 * orders channel and one more whose name the shop's settings hold, looked up
 * when the stream opens: which channel that is is not read.
 */
@Controller('shops/:shopId')
export class LiveController {
  @Sse('stream')
  stream(@Param('shopId') shopId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener: RedisClientType = createClient();
      void listener.subscribe(`shop:${shopId}:orders`, (message) => subscriber.next({ data: message } as MessageEvent));
      void listener.subscribe(`shop:${shopId}:events`, (message) => subscriber.next({ data: message } as MessageEvent));
      return () => void listener.unsubscribe();
    });
  }

  @Sse('feed')
  feed(@Param('shopId') shopId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener: RedisClientType = createClient();
      void listener.subscribe(`shop:${shopId}:orders`, (message) => subscriber.next({ data: message } as MessageEvent));
      void this.extraChannel(shopId).then((channel) => listener.subscribe(channel, (message) => subscriber.next({ data: message } as MessageEvent)));
      return () => void listener.unsubscribe();
    });
  }

  /** The channel a shop's settings name for its feed, read when the stream opens. */
  private async extraChannel(shopId: string): Promise<string> {
    const settings = await fetch(`http://settings.internal/shops/${shopId}`);
    return ((await settings.json()) as { feedChannel: string }).feedChannel;
  }
}
