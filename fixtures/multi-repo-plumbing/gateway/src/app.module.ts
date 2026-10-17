import { Module } from '@nestjs/common';

import { BillingClient } from './clients/billing.client';
import { OrdersClient } from './clients/orders.client';
import { AppLogger } from './common/app-logger';
import { Metrics } from './common/metrics';
import { OrdersController } from './orders/orders.controller';

@Module({
  controllers: [OrdersController],
  providers: [AppLogger, Metrics, BillingClient, OrdersClient],
})
export class AppModule {}
