import { Body, Controller, Delete, Get, Param } from '@nestjs/common';
import { CatalogClient } from './catalog.client';

/** The storefront's own routes, each handed on to the catalog. */
@Controller('shop')
export class ShopController {
  constructor(private readonly catalog: CatalogClient) {}

  @Get('items')
  items(): Promise<string[]> {
    return this.catalog.items();
  }

  @Get('items/:id')
  item(@Param('id') id: string): Promise<string> {
    return this.catalog.item(id);
  }

  @Delete('items/:id')
  remove(@Param('id') id: string, @Body('reason') reason: string): Promise<void> {
    return this.catalog.archive(id, reason);
  }
}
