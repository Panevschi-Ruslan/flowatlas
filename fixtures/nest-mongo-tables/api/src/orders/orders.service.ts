import { Injectable } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository.js';
import { ProductRepository } from '../catalog/product.repository.js';
import { OrdersRepository, type Order } from './orders.repository.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly products: ProductRepository,
    private readonly audit: AuditRepository,
  ) {}

  // Through the configured base: table `orders`, from the class's constant.
  list(): Promise<Order[]> {
    return this.orders.findAll();
  }

  // Through the configured base: table `products`, from the class's literal.
  item(id: string): Promise<unknown> {
    return this.products.findById(id);
  }

  // Through the base named without `tableProperty`: no table, and a row.
  history(): Promise<unknown> {
    return this.audit.list();
  }
}
