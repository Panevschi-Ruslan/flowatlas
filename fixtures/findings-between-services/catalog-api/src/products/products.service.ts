import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';
import { EventBus } from '../bus/event-bus';
import { Product } from './product.entity';

/** The catalog's data layer, telling every change on `catalog_events`. */
@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly bus: EventBus,
  ) {}

  findOne(id: string): Promise<Product | null> {
    return this.products.findOne({ where: { id } });
  }

  /** Sends the product's name as `title`; the storefront's handler reads `productTitle`. */
  async create(name: string | undefined, priceCents: number | undefined): Promise<Product> {
    const row = await this.products.save({ id: '', name: name ?? '', priceCents: priceCents ?? 0, listed: false });
    await this.bus.publish('catalog_events', { type: 'PRODUCT_CREATED', productId: row.id, title: row.name });
    return row;
  }

  async publish(id: string): Promise<void> {
    const row = await this.products.findOne({ where: { id } });
    await this.products.save({ ...row, listed: true });
  }

  /** Spelled with two l's here; the storefront handles `LISTING_CANCELED`. */
  async remove(id: string): Promise<void> {
    await this.products.delete(id);
    await this.bus.publish('catalog_events', { type: 'LISTING_CANCELLED', productId: id });
  }
}
