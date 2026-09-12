import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Observable } from 'rxjs';

import { Order } from '../types/order';
import { Paginated } from '../types/paginated';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListQuery } from './dto/list-query.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** `meta.query: 'type:nest-types#ListQuery'`; returns the instantiated generic. */
  @Get()
  list(@Query() q: ListQuery): Promise<Paginated<Order>> {
    return this.orders.list(q);
  }

  /** `Observable<Order[]>` return → `returns: 'type:nest-types#Order[]'`. */
  @Get('stream')
  stream(): Observable<Order[]> {
    return this.orders.stream();
  }

  /** `meta.params: { id: string }`. */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Order> {
    return this.orders.findOne(id);
  }

  /** `params: ['type:nest-types#CreateOrderDto']`, `meta.body: 'type:nest-types#CreateOrderDto'`, `returns: 'type:nest-types#Order'`. */
  @Post()
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.orders.create(dto);
  }

  /** `Partial<Order>` body → inlined from apparent properties, not registered under a name (§10). */
  @Put(':id')
  update(@Param('id') id: string, @Body() patch: Partial<Order>): Promise<Order> {
    return this.orders.update(id, patch);
  }

  /** `@Body('reason')` → `meta.body` is the inline `{ reason: string }` (§10); `Promise<void>` return. */
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason: string): Promise<void> {
    return this.orders.cancel(id, reason);
  }
}
