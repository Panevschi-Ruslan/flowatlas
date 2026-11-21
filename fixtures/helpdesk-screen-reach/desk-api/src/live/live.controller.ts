import { Controller, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** The stream the console holds open: every message of one desk. */
@Controller('desks/:deskId')
export class LiveController {
  @Sse('events')
  events(@Param('deskId') deskId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener: RedisClientType = createClient();
      void listener.subscribe(`desk:${deskId}:events`, (message) => {
        subscriber.next({ data: message } as MessageEvent);
      });
      return () => void listener.unsubscribe();
    });
  }
}
