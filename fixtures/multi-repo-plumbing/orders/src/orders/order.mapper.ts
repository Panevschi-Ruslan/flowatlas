import { Injectable } from '@nestjs/common';

import type { OrderDto } from './order.dto';
import type { Order } from './order.entity';

/** Row to wire shape, called from every service method: a mapper is plumbing too. */
@Injectable()
export class OrderMapper {
  toDto(row: Order): OrderDto {
    return { id: row.id, customerId: row.customerId, status: this.statusOf(row), total: row.total };
  }

  private statusOf(row: Order): string {
    return row.status.toUpperCase();
  }
}
