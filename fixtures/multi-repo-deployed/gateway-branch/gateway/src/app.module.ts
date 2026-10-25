import { Module } from '@nestjs/common';

import { BillingClient } from './clients/billing.client';
import { OrdersClient } from './clients/orders.client';
import { GatewayController } from './orders/gateway.controller';

@Module({
  controllers: [GatewayController],
  providers: [OrdersClient, BillingClient],
})
export class AppModule {}
