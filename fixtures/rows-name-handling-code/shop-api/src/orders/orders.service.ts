import { Injectable } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

/**
 * `cancel` is the method asked about. The two cart channels carry frames with
 * no `type`: no type of message is published there.
 */
@Injectable()
export class OrdersService {
  private readonly notes = new Map<string, string>();

  constructor(private readonly events: EventsService) {}

  async cancel(orderId: string, by: string): Promise<void> {
    this.events.publish('cart_canceled', orderId, { orderId, reason: by });
  }

  async expire(orderId: string): Promise<void> {
    this.events.publish('cart_expired', orderId, { orderId });
  }

  addNote(orderId: string, note: string): void {
    this.notes.set(orderId, note);
  }
}
