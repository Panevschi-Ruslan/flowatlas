import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import type { OrderPlaced } from '@shop/order-events';

import { OrdersService } from './orders.service';

@Controller()
export class OrdersConsumer {
  constructor(private readonly orders: OrdersService) {}

  @EventPattern('order.placed')
  onPlaced(@Payload() event: OrderPlaced): void {
    this.orders.record(event.orderId, event.total);
  }
}
