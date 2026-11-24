import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';
import { EventBus } from '../bus/event-bus';
import { Product } from '../products/product.entity';

/** Stock levels, and what is told on `stock_events`. */
@Injectable()
export class StockService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly bus: EventBus,
  ) {}

  async level(sku: string): Promise<number> {
    const rows = await this.products.find({ where: { id: sku } });
    return rows.length;
  }

  async restocked(sku: string): Promise<void> {
    await this.bus.publish('stock_events', { type: 'STOCK_RESTOCKED', sku });
  }

  /** The type is the caller's: which one this publishes is not read. */
  async changed(kind: string, sku: string): Promise<void> {
    await this.bus.publish('stock_events', { type: kind, sku });
  }
}
