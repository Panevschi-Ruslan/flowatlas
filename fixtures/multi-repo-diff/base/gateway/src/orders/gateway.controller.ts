import { Body, Controller, Post } from '@nestjs/common';

import type { CreateOrderDto, OrderDto } from '../clients/dto';
import { OrdersClient } from '../clients/orders.client';

/** What the browser talks to. One hop, and then it is the orders service's. */
@Controller('orders')
export class GatewayController {
  constructor(private readonly orders: OrdersClient) {}

  @Post()
  create(@Body() body: CreateOrderDto): OrderDto {
    this.orders.create(body);
    return { id: '1', customerId: body.customerId, status: 'created' };
  }
}
