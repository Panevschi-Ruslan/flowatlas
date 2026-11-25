import { Injectable } from '@nestjs/common';
import { CatalogBus } from './catalog-bus';

/** Publishes what happens to products on `catalog_events`, told apart by `type`. */
@Injectable()
export class CatalogService {
  constructor(private readonly bus: CatalogBus) {}

  async priceChanged(sku: string, price: number): Promise<void> {
    await this.bus.publish('catalog_events', { type: 'PRICE_CHANGED', sku, price });
  }

  async stockLow(sku: string, left: number): Promise<void> {
    await this.bus.publish('catalog_events', { type: 'STOCK_LOW', sku, left });
  }

  async retired(sku: string, reason: string): Promise<void> {
    await this.bus.publish('catalog_events', { type: 'PRODUCT_RETIRED', sku, reason });
  }
}
