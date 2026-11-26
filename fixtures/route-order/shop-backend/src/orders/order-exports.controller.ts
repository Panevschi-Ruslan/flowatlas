import { Controller, Get } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** Registered after `OrdersController`, whose `:orderId` answers `/orders/export` first. */
@Controller('orders')
export class OrderExportsController {
  constructor(private readonly orders: OrdersService) {}

  @Get('export')
  exportAll(): string {
    return this.orders.exportCsv();
  }
}
