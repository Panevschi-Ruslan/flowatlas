import { Controller, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';

import { EventsService } from '../bus/events.service';

/** The desks' alerts relayed to the browser as server-sent events. */
@Controller('api/events')
export class StreamController {
  constructor(private readonly bus: EventsService) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) =>
      this.bus.subscribe('desk_alerts', (data) => subscriber.next({ data: data as object })),
    );
  }
}
