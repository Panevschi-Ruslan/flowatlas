import { bus } from '../bus/event-bus';
import type { OrderEvent } from './order.dto';

/**
 * The same publish, written as a module-level function.
 *
 * Nothing about it is different from `OrdersService.publishCreated` except the
 * body it is written in, and until R54 that difference was the whole graph: the
 * broker reader walked class methods only, so this line produced no producer
 * and no channel, and the worker looked like it listened to something nobody
 * sent.
 */
export function notifyCreated(event: OrderEvent): void {
  bus.publish('orders:created', event);
}

/**
 * A module of functions spelled as an object, which is the other way a service
 * without a container groups what it does.
 */
export const invoices = {
  notifyInvoiced(event: OrderEvent): void {
    bus.publish('orders:invoiced', event);
  },
};
