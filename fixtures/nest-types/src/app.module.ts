import { Module } from '@nestjs/common';

import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [OrdersModule, CatalogModule],
})
export class AppModule {}
