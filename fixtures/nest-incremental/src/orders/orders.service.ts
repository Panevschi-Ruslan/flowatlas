import { Inject, Injectable } from '@nestjs/common';

import { BillingClient } from '../billing/billing.client';
import { BILLING_CLIENT } from '../shared/tokens';
import type { CreateOrderDto, OrderDto } from './dto/create-order.dto';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(BILLING_CLIENT) private readonly billing: BillingClient,
    private readonly orders: OrdersRepository,
  ) {}

  findOne(id: string): OrderDto {
    return this.orders.find(id);
  }

  create(body: CreateOrderDto): OrderDto {
    const order = this.orders.save({
      id: 'new',
      customerId: body.customerId,
      total: body.total,
      status: 'created',
    });
    this.billing.charge(order.id);
    return order;
  }
}
