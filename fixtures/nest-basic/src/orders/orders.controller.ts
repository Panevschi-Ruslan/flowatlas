import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';

function buildLegacyPath(): string {
  return 'legacy';
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(): string[] {
    return this.orders.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): string {
    return this.orders.findOne(id);
  }

  @Post()
  create(@Body() body: { userId: string }): string {
    return this.orders.create(body.userId);
  }

  @Delete(':orderId')
  remove(@Param('orderId') orderId: string): string {
    return this.orders.remove(orderId);
  }

  // unresolved: route-path-dynamic — the path is a function call, not a literal / const /
  // enum member, so no entry may be emitted for this handler.
  @Get(buildLegacyPath())
  findLegacy(): string[] {
    return this.orders.findAll();
  }
}
