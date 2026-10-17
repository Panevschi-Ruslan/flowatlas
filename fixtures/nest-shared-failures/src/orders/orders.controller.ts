import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Put } from '@nestjs/common';

import { ShopService, type Record } from '../shared/shop.service';

@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  constructor(private readonly shop: ShopService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.log(`reading order ${id}`);
    return this.shop.find('order', id);
  }

  @Post()
  create(@Body() body: Record) {
    this.logger.log(`creating order ${body.id}`);
    return this.shop.save('order', body);
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body() body: Record) {
    this.logger.log(`replacing order ${id}`);
    return this.shop.save('order', { ...body, id });
  }

  @Patch(':id')
  touch(@Param('id') id: string) {
    this.logger.warn(`touching order ${id}`);
    return this.shop.load('order', id);
  }

  @Post(':id/copy')
  copy(@Param('id') id: string) {
    this.logger.log(`copying order ${id}`);
    const found = this.shop.find('order', id);
    return this.shop.save('order', { ...found, id: `${id}-copy` });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.logger.warn(`removing order ${id}`);
    return this.shop.load('order', id);
  }
}
