import { Injectable } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';

@Injectable()
export class ItemsService {
  private readonly stock = new Map<string, number>();

  constructor(private readonly bus: EventBus) {}

  async list(): Promise<string[]> {
    return [...this.stock.keys()];
  }

  async findOne(id: string): Promise<string> {
    return id;
  }

  async archive(id: string, reason: string): Promise<void> {
    this.stock.delete(id);
    console.log(`archived ${id}: ${reason}`);
  }

  /** Tells the alerts bot an item runs low, as `sku` and `remaining`. */
  async take(sku: string, count: number): Promise<void> {
    const remaining = (this.stock.get(sku) ?? 0) - count;
    this.stock.set(sku, remaining);
    if (remaining < 5) await this.bus.publish('stock_events', { type: 'STOCK_LOW', itemCode: sku, remaining });
  }
}
