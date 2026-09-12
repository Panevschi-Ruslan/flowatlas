import { Controller, Get, Param, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { EventBus } from '../events/event-bus.service';
import type { DepotEvent } from '../events/depot-event';

/**
 * The route the browser holds open.
 *
 * It reads from the bus's rxjs side, not from the transport, so nothing here
 * names a channel either. This is the far end of the `hits` edge the browser's
 * subscription makes, and the near end of the hop the graph deliberately does
 * not draw: what reaches this stream is decided by an rxjs pipeline.
 */
@Controller('depots/:depotId')
export class EventsController {
  constructor(private readonly bus: EventBus) {}

  @Get('events')
  @Sse()
  stream(@Param('depotId') depotId: string): Observable<MessageEvent> {
    return this.bus
      .forDepot(depotId)
      .pipe(map((event: DepotEvent) => ({ data: event }) as MessageEvent));
  }
}
