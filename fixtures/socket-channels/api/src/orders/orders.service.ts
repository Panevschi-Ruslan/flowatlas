import { Injectable } from '@nestjs/common';

import type { CancelOrder, OrderSummary, OrderUpdate } from './order-events';

@Injectable()
export class OrdersService {
  cancel(command: CancelOrder): OrderUpdate {
    return { orderId: command.orderId, total: 0, state: 'ORDER_CLOSED' };
  }

  summarise(orderId: string): OrderSummary {
    return { orderId, lines: 2, total: 40 };
  }
}
