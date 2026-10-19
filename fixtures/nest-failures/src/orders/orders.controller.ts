import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { OwnerGuard } from '../guards/owner.guard';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(AuthGuard('jwt'))
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.orders.findOne(id);
  }

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(@Body() body: { id: number; sku: string; quantity: number; coupon?: string }) {
    return this.orders.create(body);
  }

  @Delete(':id')
  @UseGuards(OwnerGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    this.orders.remove(id);
  }
}
