import { Injectable } from '@nestjs/common';

import type { Order } from './order.model';

@Injectable()
export class OrdersService {
  list(): Order[] {
    return [{ id: '1', status: 'open' }];
  }

  cancel(id: string): Order {
    return { id, status: 'cancelled' };
  }
}
