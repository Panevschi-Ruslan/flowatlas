import { Controller, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** The stream the screens hold open: every message of one shop. */
@Controller('api/shops/:shopId')
export class LiveController {
  @Sse('events')
  events(@Param('shopId') shopId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener: RedisClientType = createClient();
      void listener.subscribe(`shop:${shopId}:events`, (message) => {
        subscriber.next({ data: message } as MessageEvent);
      });
      return () => void listener.unsubscribe();
    });
  }
}
