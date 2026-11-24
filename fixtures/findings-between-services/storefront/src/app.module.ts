import { Module } from '@nestjs/common';
import { CatalogClient } from './catalog.client';
import { CatalogEventsService } from './catalog-events.service';
import { LegacyClient } from './legacy.client';
import { ShopController } from './shop.controller';
import { StockEventsService } from './stock-events.service';

@Module({
  controllers: [ShopController],
  providers: [CatalogClient, LegacyClient, CatalogEventsService, StockEventsService],
})
export class AppModule {}
