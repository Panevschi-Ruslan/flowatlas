import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';

export interface Order {
  id: string;
  name: string;
  status: 'open' | 'cancelled';
}

@Controller('orders')
export class OrdersController {
  private readonly orders = new Map<string, Order>();

  @Get()
  list(): Order[] {
    return [...this.orders.values()];
  }

  @Get(':id')
  findOne(@Param('id') id: string): Order {
    const order = this.orders.get(id);
    if (order === undefined) throw new NotFoundException(`no order ${id}`);
    return order;
  }

  @Post()
  create(@Body() body: { name: string }): Order {
    const order: Order = { id: String(this.orders.size + 1), name: body.name, status: 'open' };
    this.orders.set(order.id, order);
    return order;
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): Order {
    const order = this.findOne(id);
    order.status = 'cancelled';
    return order;
  }
}
