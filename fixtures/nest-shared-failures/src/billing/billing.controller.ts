import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Put } from '@nestjs/common';

import { ShopService, type Record } from '../shared/shop.service';

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly shop: ShopService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.log(`reading invoice ${id}`);
    return this.shop.find('invoice', id);
  }

  @Post()
  create(@Body() body: Record) {
    this.logger.log(`creating invoice ${body.id}`);
    return this.shop.save('invoice', body);
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body() body: Record) {
    this.logger.log(`replacing invoice ${id}`);
    return this.shop.save('invoice', { ...body, id });
  }

  @Patch(':id')
  touch(@Param('id') id: string) {
    this.logger.warn(`touching invoice ${id}`);
    return this.shop.load('invoice', id);
  }

  @Post(':id/copy')
  copy(@Param('id') id: string) {
    this.logger.log(`copying invoice ${id}`);
    const found = this.shop.find('invoice', id);
    return this.shop.save('invoice', { ...found, id: `${id}-copy` });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.logger.warn(`removing invoice ${id}`);
    return this.shop.load('invoice', id);
  }
}
