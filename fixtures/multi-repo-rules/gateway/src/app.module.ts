import { Module } from '@nestjs/common';

import { OrderAuditConsumer } from './audit/order-audit.consumer';
import { BillingClient } from './clients/billing.client';
import { OrdersClient } from './clients/orders.client';
import { PaymentsClient } from './clients/payments.client';
import { ServiceRegistry } from './clients/service-registry';
import { OrdersController } from './orders/orders.controller';

@Module({
  controllers: [OrdersController, OrderAuditConsumer],
  providers: [OrdersClient, BillingClient, PaymentsClient, ServiceRegistry],
})
export class AppModule {}
