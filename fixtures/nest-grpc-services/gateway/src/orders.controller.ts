import { Controller, Get, Param } from '@nestjs/common';
import { OrdersClient } from './orders.client';

@Controller('orders')
export class OrdersGatewayController {
  constructor(private readonly orders: OrdersClient) {}

  @Get(':id')
  find(@Param('id') id: string) {
    return this.orders.find(id);
  }

  @Get()
  list(@Param('customer') customer: string) {
    return this.orders.byCustomer(customer);
  }
}
