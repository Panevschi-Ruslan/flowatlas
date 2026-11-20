import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * The project's own helper between a route and the broker: it subscribes to
 * whatever channel it is handed and turns each message into a frame. Read
 * where it is written, the channel is a parameter; read at the route that
 * calls it, it is the channel that route names.
 */
@Injectable()
export class RelayService {
  frames(channel: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener: RedisClientType = createClient();
      void listener.subscribe(channel, (message) => subscriber.next({ data: message } as MessageEvent));
      return () => void listener.unsubscribe(channel);
    });
  }
}
