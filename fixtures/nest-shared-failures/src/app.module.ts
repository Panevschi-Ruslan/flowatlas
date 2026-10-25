import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { BillingController } from './billing/billing.controller';
import { CatalogController } from './catalog/catalog.controller';
import { OrdersController } from './orders/orders.controller';
import { ApiKeyGuard } from './shared/api-key.guard';
import { ShopService } from './shared/shop.service';

@Module({
  controllers: [OrdersController, BillingController, CatalogController],
  providers: [ShopService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
