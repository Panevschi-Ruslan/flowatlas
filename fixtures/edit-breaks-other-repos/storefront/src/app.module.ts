import { Module } from '@nestjs/common';
import { CatalogClient } from './catalog.client';
import { ShopController } from './shop.controller';

@Module({
  controllers: [ShopController],
  providers: [CatalogClient],
})
export class AppModule {}
