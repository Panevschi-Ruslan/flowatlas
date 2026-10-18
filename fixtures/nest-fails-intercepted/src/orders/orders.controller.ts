import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';

import { StockInterceptor } from '../interceptors/stock.interceptor';
import { CreateOrderDto } from './create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseInterceptors(StockInterceptor)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.place(dto);
  }
}
