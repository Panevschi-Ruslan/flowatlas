import { Injectable } from '@nestjs/common';
import { Repo } from 'fake-orm';
import type { Order } from './order.js';
import { OrdersRepository } from './orders.repository.js';

@Injectable()
export class OrdersService {
  // Typed by a package with no descriptor. The entity is still in the types,
  // so the table is known and only the operation is lost.
  // Expected: table "Order", op null, heuristic, unknown-db-package.
  private readonly orderRepo = new Repo<Order>();

  constructor(private readonly localRepo: OrdersRepository) {}

  listFromLibrary(): Promise<Order[]> {
    return this.orderRepo.find();
  }

  store(order: Order): Promise<Order> {
    return this.orderRepo.persist(order);
  }

  // Nothing but the name suggests data access here.
  // Expected: no table, heuristic, db-receiver-name-only.
  listLocally(): Order[] {
    return this.localRepo.find();
  }
}
