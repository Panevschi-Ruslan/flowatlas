import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateOrderDto, OrderDto } from '@fx/contracts';

import { OrdersService } from './orders.service';

/** The routes the gateway aims at, and the ones it misses. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * The literal half of the §10 pair. It is declared before `findOne` because
   * that is the order a real Nest application needs; the linker does not model
   * registration order, it matches segment by segment, so a client asking for
   * `/orders/latest` lands here and a client asking for `/orders/:param` lands
   * on `findOne`. Nobody calls it: `routes.uncalled`.
   */
  @Get('latest')
  latest(): Promise<OrderDto[]> {
    return this.orders.latest();
  }

  /** Called by the gateway. `entry:orders:http:GET:/orders/:param`. */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<OrderDto> {
    return this.orders.findOne(id);
  }

  /** Nobody calls it: `routes.uncalled`. */
  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }

  /**
   * The route the gateway's `cancel` call was looking for and did not find.
   * `POST /orders/:param/archive` exists; `POST /orders/:param/cancel` does not,
   * which is what makes `target-route-not-found` a drift detector rather than a
   * typo detector: the client was not renamed with the server.
   */
  @Post(':id/archive')
  archive(@Param('id') id: string): Promise<void> {
    return this.orders.archive(id);
  }
}
