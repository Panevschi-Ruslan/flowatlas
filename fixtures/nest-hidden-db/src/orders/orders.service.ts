import { Injectable } from '@nestjs/common';
import type { Order } from './order.js';
import { OrderStore } from './order.store.js';

/**
 * The receiver is named after the thing stored rather than after the layer,
 * which is how the real project names them. Neither the type nor the name comes
 * from a package, so only the configuration can say these calls touch data.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly orders: OrderStore) {}

  async get(id: string): Promise<Order | null> {
    return this.orders.findById(id);
  }

  async create(order: Order): Promise<Order> {
    return this.orders.save(order);
  }

  connection(): string {
    return process.env.MONGO_URL ?? '';
  }
}
