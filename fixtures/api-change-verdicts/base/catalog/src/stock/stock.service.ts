import { Injectable } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';

/** What `stock.changed` carries. */
export interface StockChanged {
  itemId: string;
  warehouse: string;
  count: number;
}

@Injectable()
export class StockService {
  constructor(private readonly bus: EventBus) {}

  async recount(itemId: string): Promise<void> {
    const changed: StockChanged = { itemId, warehouse: 'north', count: 4 };
    await this.bus.publish('stock.changed', changed);
  }
}
