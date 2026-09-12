import { Injectable } from '@nestjs/common';

import type { OrderDto } from './dto/create-order.dto';

/** Stands in for a data layer, so the service has something local to call. */
@Injectable()
export class OrdersRepository {
  find(id: string): OrderDto {
    return { id, customerId: '', total: 0, status: 'new' };
  }

  save(order: OrderDto): OrderDto {
    return order;
  }
}
