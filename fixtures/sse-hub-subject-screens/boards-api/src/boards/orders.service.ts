import { Injectable } from '@nestjs/common';

import { BoardEventBus } from '../bus/board-event-bus';
import { BusService } from '../bus/bus.service';

/**
 * A board's orders channel, routed to the worker alone. Three ways a type is
 * published on it: through the described publisher, through the publisher with
 * the channel held in a local first, and by calling the project's own bus
 * directly - the one way `SCHEDULED_ALERT` is ever sent.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly events: BoardEventBus,
    private readonly busService: BusService,
  ) {}

  async place(boardId: string, orderId: string): Promise<void> {
    await this.events.publish(`board:${boardId}:orders`, { type: 'ORDER_PLACED', orderId });
  }

  async ship(boardId: string, orderId: string): Promise<void> {
    const channel = `board:${boardId}:orders`;
    await this.events.publish(channel, { type: 'ORDER_SHIPPED', orderId });
  }

  async scheduleAlert(boardId: string, orderId: string): Promise<void> {
    await this.busService.publish(`board:${boardId}:orders`, { type: 'SCHEDULED_ALERT', orderId });
  }
}
