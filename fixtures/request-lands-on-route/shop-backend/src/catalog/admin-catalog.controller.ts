import { Controller, Get, Param } from '@nestjs/common';
import { CatalogService, type CatalogGroup } from './catalog.service';

@Controller('admin/:storeId/catalog')
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('grouped')
  grouped(@Param('storeId') storeId: string): CatalogGroup[] {
    return this.catalog.grouped(storeId);
  }

  @Get(':itemId')
  item(@Param('storeId') storeId: string, @Param('itemId') itemId: string): string {
    return this.catalog.item(storeId, itemId);
  }
}
