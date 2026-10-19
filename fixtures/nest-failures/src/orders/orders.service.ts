import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { CouponRejectedError } from './errors';
import { assertInStock } from './stock';

interface Order {
  id: number;
  sku: string;
  quantity: number;
  coupon?: string;
}

@Injectable()
export class OrdersService {
  private readonly orders = new Map<number, Order>();

  findOne(id: number): Order {
    const order = this.orders.get(id);
    if (order === undefined) throw new NotFoundException(`order ${id}`);
    return order;
  }

  create(order: Order): Order {
    if (this.orders.has(order.id)) throw new HttpException('already placed', HttpStatus.CONFLICT);
    if (order.coupon === 'EXPIRED') throw new CouponRejectedError('coupon expired');
    assertInStock(order.sku, order.quantity);
    this.orders.set(order.id, order);
    return order;
  }

  remove(id: number): void {
    try {
      // Caught right here, so it is not a way this route fails.
      if (id < 0) throw new ConflictException('negative id');
    } catch (error) {
      if (id === 0) throw error;
    }
    if (!this.orders.delete(id)) throw new Error(`order ${id} vanished`);
  }
}
