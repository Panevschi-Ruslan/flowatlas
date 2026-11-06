import { Module } from '@nestjs/common';
import { BillingClient } from './billing.client';
import { FulfilController } from './fulfil.controller';
import { OrdersClient } from './orders.client';

@Module({
  controllers: [FulfilController],
  providers: [OrdersClient, BillingClient],
})
export class AppModule {}
