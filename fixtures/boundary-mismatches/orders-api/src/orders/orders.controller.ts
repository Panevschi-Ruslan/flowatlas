import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { CreateOrderDto, RenameOrderDto } from './dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(): Promise<string[]> {
    return this.orders.list();
  }

  /** The global pipe forbids what `CreateOrderDto` does not declare. */
  @Post()
  create(@Body() body: CreateOrderDto): Promise<string> {
    return this.orders.create(body);
  }

  /** Answers 409 when the order has shipped and 404 when there is none; never 410. */
  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<void> {
    return this.orders.cancel(id);
  }

  /** Answers with a status computed at run time. */
  @Post(':id/refund')
  refund(@Param('id') id: string): Promise<void> {
    return this.orders.refund(id);
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: RenameOrderDto): Promise<void> {
    return this.orders.rename(id, body.title);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.orders.remove(id);
  }
}
