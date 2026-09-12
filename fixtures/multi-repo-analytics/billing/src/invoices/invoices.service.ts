import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class InvoicesService {
  constructor(@Inject('EVENTS_CLIENT') private readonly events: ClientProxy) {}

  create(orderId: string): Promise<unknown> {
    return Promise.resolve({ orderId });
  }

  /**
   * The reply half of the message loop.
   *
   * `orders` publishes `order.changed`, this answers with `invoice.changed`,
   * and `orders` handles that by publishing `order.changed` again. Two
   * reasonable services and an event storm nobody can see from either one.
   */
  sync(orderId: string): void {
    this.events.emit('invoice.changed', { orderId });
  }
}
