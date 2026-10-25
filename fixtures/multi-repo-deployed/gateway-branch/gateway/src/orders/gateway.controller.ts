import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { BillingClient } from '../clients/billing.client';
import type { CreateOrderDto, OrderDto } from '../clients/dto';
import { OrdersClient } from '../clients/orders.client';

/** What the bookshop's browser talks to. This branch invoices every order it places. */
@Controller('orders')
export class GatewayController {
  constructor(
    private readonly orders: OrdersClient,
    private readonly billing: BillingClient,
  ) {}

  @Post()
  create(@Body() body: CreateOrderDto): OrderDto {
    this.orders.create(body);
    this.billing.invoice({ orderId: '1', amount: body.quantity * 10 });
    return { id: '1', bookId: body.bookId, status: 'placed' };
  }

  @Get(':id')
  findOne(@Param('id') id: string): void {
    this.orders.findOne(id);
  }
}
