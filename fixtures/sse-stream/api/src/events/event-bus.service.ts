import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';
import { Broadcaster } from './broadcaster.service';
import { Metrics } from './metrics.service';
import type { DepotEvent } from './depot-event';

/**
 * The one place in the service that receives from the bus.
 *
 * Everything the browser eventually sees arrives here first and is handed on
 * over rxjs; the route that streams it never touches the bus itself. That is why
 * the browser cannot name a channel and the consumer is here, one hop inside the
 * service, rather than out in the browser.
 */
@Injectable()
export class EventBus implements OnModuleInit {
  private readonly events = new Subject<DepotEvent>();

  constructor(
    private readonly broadcaster: Broadcaster,
    private readonly metrics: Metrics,
  ) {}

  async onModuleInit(): Promise<void> {
    // The subscription that matters. The listener does exactly one thing, so the
    // consumer lands on `receive`, and the pattern's `*` is the same hole the
    // publishing template leaves, so both ends meet on `channel:depot:*:events`.
    // Expected: `consumer` on `EventBus.receive`, `consumes` from that channel, static.
    await this.broadcaster.pSubscribe('depot:*:events', (message) => this.receive(message));

    // Same method name, a type the configuration does not name. Expected: nothing
    // at all — a method called `pSubscribe` is not evidence of a subscription.
    await this.metrics.pSubscribe('depot:*:events', (message) => this.count(message));
  }

  /** Where the pattern is an argument, so there is no channel to join on. */
  async listenTo(pattern: string): Promise<void> {
    // Expected: `consumer` on `EventBus.receive`, no channel node, unresolved
    // `channel-const-unresolved` naming `EventBus.listenTo`.
    await this.broadcaster.pSubscribe(pattern, (message) => this.receive(message));
  }

  receive(message: string): void {
    this.events.next(JSON.parse(message) as DepotEvent);
  }

  count(message: string): void {
    void message.length;
  }

  forDepot(depotId: string): Observable<DepotEvent> {
    return this.events.pipe(filter((event) => event.depotId === depotId));
  }
}
