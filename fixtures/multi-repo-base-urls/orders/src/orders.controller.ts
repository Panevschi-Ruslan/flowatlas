import { Controller, Get, Param } from '@nestjs/common';

@Controller('orders')
export class OrdersController {
  /** Reached from the shop by `ORDERS_API` and by `ORDERS_SERVICE_URL`, and from payments and the catalog. */
  @Get(':id')
  findOne(@Param('id') id: string): { id: string } {
    return { id };
  }
}
