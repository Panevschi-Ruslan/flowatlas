import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

/**
 * `cancel` is the method asked about. The two cart channels carry frames with
 * no `type`: no type of message is published there. It refuses four ways
 * (P375), so every way in reaching it can fail four ways more.
 */
@Injectable()
export class OrdersService {
  private readonly notes = new Map<string, string>();
  private readonly statuses = new Map<string, 'open' | 'shipped' | 'cancelled'>();

  constructor(private readonly events: EventsService) {}

  async cancel(orderId: string, by: string): Promise<void> {
    const status = this.statuses.get(orderId);
    if (status === undefined) throw new NotFoundException(`no order ${orderId}`);
    if (status === 'shipped') throw new ConflictException('a shipped order cannot be cancelled');
    if (status === 'cancelled') throw new GoneException('the order is cancelled already');
    if (by === '') throw new BadRequestException('say who cancels');
    this.events.publish('cart_canceled', orderId, { orderId, reason: by });
  }

  async expire(orderId: string): Promise<void> {
    this.events.publish('cart_expired', orderId, { orderId });
  }

  addNote(orderId: string, note: string): void {
    this.notes.set(orderId, note);
  }
}
