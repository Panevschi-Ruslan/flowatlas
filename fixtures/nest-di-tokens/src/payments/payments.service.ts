import { Inject, Injectable, forwardRef } from '@nestjs/common';

import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PaymentsService {
  constructor(
    // forwardRef: the other half of the OrdersService <-> PaymentsService cycle.
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
  ) {}

  charge(id: string): string {
    return `charged:${id}`;
  }

  refund(id: string): string {
    return this.orders.describe(id);
  }
}
