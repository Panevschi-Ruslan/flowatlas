import { Injectable, NotFoundException } from '@nestjs/common';

import type { Order, PlaceOrderInput } from './order.model';

@Injectable()
export class OrdersService {
  private readonly orders = new Map<string, Order>();

  list(status?: string): Order[] {
    return [...this.orders.values()].filter((order) => status === undefined || order.note === status);
  }

  byId(id: string): Order {
    const order = this.orders.get(id);
    if (order === undefined) throw new NotFoundException(`no order ${id}`);
    return order;
  }

  place(input: PlaceOrderInput): Order {
    const order = { id: String(this.orders.size + 1), total: input.total, customerId: input.customerId };
    this.orders.set(order.id, order);
    return order;
  }
}
