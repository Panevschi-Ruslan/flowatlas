import { EventBus } from '../bus/event-bus';
import type { OrderEvent } from './order.dto';

/**
 * The control: a publish written as a method of a class.
 *
 * This is the one spelling the reader has always understood, and it is here so
 * that the three below it have something to be identical to. The channel it
 * names is the same one `notifyCreated` names one file over, so the graph holds
 * one channel with two producers hanging off two different kinds of body.
 */
export class OrdersService {
  constructor(private readonly bus: EventBus) {}

  publishCreated(event: OrderEvent): void {
    this.bus.publish('orders:created', event);
  }
}
