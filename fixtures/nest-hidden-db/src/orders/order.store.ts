import { Injectable } from '@nestjs/common';
import { MongoStore } from '../data/mongo-store.js';
import type { Order } from './order.js';

@Injectable()
export class OrderStore extends MongoStore<Order> {
  protected readonly collectionName = 'orders';

  async findById(id: string): Promise<Order | null> {
    return this.one(id);
  }

  async save(order: Order): Promise<Order> {
    return this.put(order.id, order);
  }
}
