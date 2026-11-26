import { Controller, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';

import { EventsService } from '../bus/events.service';

/** The orders channel relayed to the browser as server-sent events. */
@Controller('events')
export class StreamController {
  constructor(private readonly bus: EventsService) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) =>
      this.bus.subscribe('order_updates', (data) => subscriber.next({ data: data as object })),
    );
  }
}
