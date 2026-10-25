import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { Order } from './order.entity';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('one-by-one')
  oneByOne(@Body() ids: string[]): Promise<Order[]> {
    return this.orders.byIdsOneByOne(ids);
  }

  @Post('together')
  together(@Body() ids: string[]): Promise<Array<Order | null>> {
    return this.orders.byIdsTogether(ids);
  }

  @Get('summary/:userId')
  summary(@Param('userId') userId: string): Promise<[Order[], Order | null]> {
    return this.orders.summary(userId);
  }

  @Get('totals')
  totals(): Promise<number> {
    return this.orders.totals();
  }

  @Post('bulk')
  bulk(@Body() list: Order[]): Promise<void> {
    return this.orders.saveAll(list);
  }

  @Post('later')
  later(@Body() ids: string[]): number {
    return this.orders.later(ids).length;
  }
}
