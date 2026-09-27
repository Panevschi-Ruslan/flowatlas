import { Injectable } from '@nestjs/common';

import { EventBus } from '../bus/event-bus.service';
import type { OrderCreated } from './order.dto';

/**
 * The read half of the channel, with nothing unusual about it.
 *
 * That is the point of the fixture: the publish is ordinary code in a repository
 * the tool opens, and the two services that receive the message are documents.
 * The publisher has no idea, and nothing here says so.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly bus: EventBus) {}

  created(event: OrderCreated): void {
    this.bus.publish('orders.created', event);
  }
}
