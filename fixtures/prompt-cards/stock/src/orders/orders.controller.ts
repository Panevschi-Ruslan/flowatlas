import { Controller, Get, Param } from '@nestjs/common';

/** Spelled exactly as `shop-api`'s: a prompt naming `stock-api` picks this one. */
@Controller('orders')
export class OrdersController {
  @Get(':orderId/reserved')
  findOne(@Param('orderId') orderId: string): number {
    return orderId.length;
  }
}
