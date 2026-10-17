import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Put } from '@nestjs/common';

import { ShopService, type Record } from '../shared/shop.service';

@Controller('catalog')
export class CatalogController {
  private readonly logger = new Logger(CatalogController.name);

  constructor(private readonly shop: ShopService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.log(`reading product ${id}`);
    return this.shop.find('product', id);
  }

  @Post()
  create(@Body() body: Record) {
    this.logger.log(`creating product ${body.id}`);
    return this.shop.save('product', body);
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body() body: Record) {
    this.logger.log(`replacing product ${id}`);
    return this.shop.save('product', { ...body, id });
  }

  @Patch(':id')
  touch(@Param('id') id: string) {
    this.logger.warn(`touching product ${id}`);
    return this.shop.load('product', id);
  }

  @Post(':id/copy')
  copy(@Param('id') id: string) {
    this.logger.log(`copying product ${id}`);
    const found = this.shop.find('product', id);
    return this.shop.save('product', { ...found, id: `${id}-copy` });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.logger.warn(`removing product ${id}`);
    return this.shop.load('product', id);
  }
}
