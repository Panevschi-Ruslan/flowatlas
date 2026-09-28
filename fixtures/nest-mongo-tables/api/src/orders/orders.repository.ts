import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository.js';
import { ORDERS_COLLECTION } from './order.names.js';

export interface Order { _id: string; total: number }

/** The table stated with a constant. */
@Injectable()
export class OrdersRepository extends BaseRepository<Order> {
  protected readonly collectionName = ORDERS_COLLECTION;

  // Through a constant bound to the base's accessor, the way most finders read:
  // `orders`, read.
  async large(): Promise<Order[]> {
    const c = await this.coll();
    return c.find({ total: 100 }).toArray();
  }
}
