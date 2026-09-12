import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { Order } from './order.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    // Deliberately named `orderCache`, deliberately still a `Repository<Order>`.
    // The declaring package (`node_modules/typeorm`) is the only signal that decides
    // "this is data access", so every call on this receiver is level 1 / `static`
    // exactly like the ones on `orders` — the name must not downgrade it, and it must
    // not be mistaken for a `cache_op`.
    @InjectRepository(Order)
    private readonly orderCache: Repository<Order>,
  ) {}

  // db_query #1 — level 1: package `typeorm`, table `Order`, meta.op `read`, static.
  findAll(): Promise<Order[]> {
    return this.orders.find();
  }

  // db_query #2 — level 1: table `Order`, meta.op `write`, static.
  create(order: Order): Promise<Order> {
    return this.orders.save(order);
  }

  // db_query #3 — level 1: table `Order`, meta.op `delete`, static.
  remove(id: string): Promise<void> {
    return this.orders.delete(id);
  }

  // db_query #4 — level 1: table `Order`, meta.op `read`, static, meta.receiver
  // `orderCache`. Origin wins over the receiver name (P03 §4, phase-specific).
  recent(): unknown {
    return this.orderCache.createQueryBuilder('order');
  }
}
