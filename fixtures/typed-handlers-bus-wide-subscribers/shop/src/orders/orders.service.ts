import { Injectable } from '@nestjs/common';

import { EventsService } from '../bus/events.service';

@Injectable()
export class OrdersService {
  constructor(private readonly events: EventsService) {}

  markReady(orderId: string, label: string): void {
    this.events.publish('order_updates', orderId, { type: 'ORDER_READY', orderId, label });
  }

  changeStatus(orderId: string, status: string): void {
    this.events.publish('order_updates', orderId, { type: 'STATUS_CHANGED', orderId, status });
  }

  cancel(orderId: string): void {
    this.events.publish('order_updates', orderId, { type: 'ORDER_CANCELLED', orderId });
  }

  place(orderId: string): void {
    this.events.publish('order_updates', orderId, { type: 'ORDER_PLACED', orderId });
  }

  refund(orderId: string): void {
    this.events.publish('order_updates', orderId, { type: 'ORDER_REFUNDED', orderId });
  }
}
