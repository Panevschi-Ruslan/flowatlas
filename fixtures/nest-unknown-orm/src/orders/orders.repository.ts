import { Injectable } from '@nestjs/common';
import type { Order } from './order.js';

/**
 * A repository written by hand, with no library behind it and no base class
 * named in the configuration. Nothing but its name suggests it touches data.
 */
@Injectable()
export class OrdersRepository {
  private readonly rows: Order[] = [];

  find(): Order[] {
    return this.rows;
  }
}
