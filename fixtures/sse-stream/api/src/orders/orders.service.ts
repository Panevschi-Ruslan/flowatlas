import { Inject, Injectable } from '@nestjs/common';
import { EVENT_PUBLISHER } from '../events/event-publisher';
import type { EventPublisher } from '../events/event-publisher';

/**
 * The publishing half. The channel is addressed per depot, so the name is a
 * template and the family it belongs to is `depot:*:events`.
 */
@Injectable()
export class OrdersService {
  constructor(@Inject(EVENT_PUBLISHER) private readonly events: EventPublisher) {}

  // Expected: `producer` on `channel:depot:*:events`, `meta.channelVia:
  // "template"`, payload `DepotEvent`.
  async cancel(depotId: string, orderId: string): Promise<void> {
    await this.events.publish(`depot:${depotId}:events`, {
      type: 'ORDER_CANCELED',
      depotId,
      orderId,
    });
  }
}
