import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { AuditService } from './audit/audit.service';
import { AccountsClient } from './clients/accounts.client';
import { BillingClient } from './clients/billing.client';
import { InvoicesConsumer } from './invoices/invoices.consumer';
import { OrdersController } from './orders/orders.controller';
import { OrdersRepository } from './orders/orders.repository';
import { OrdersService } from './orders/orders.service';
import { UnusedService } from './orders/unused.service';
import { DiscountService } from './pricing/discount.service';
import { PricingService } from './pricing/pricing.service';

/**
 * `UnusedService` is registered and never injected, which is exactly how a
 * provider that has outlived its callers looks from the outside. It is not
 * exported, so nothing outside this module can be reaching it either.
 */
@Module({
  imports: [
    ClientsModule.register([
      { name: 'EVENTS_CLIENT', transport: Transport.TCP, options: { host: 'localhost', port: 4001 } },
    ]),
  ],
  controllers: [OrdersController, InvoicesConsumer],
  providers: [
    OrdersService,
    OrdersRepository,
    AccountsClient,
    BillingClient,
    AuditService,
    PricingService,
    DiscountService,
    UnusedService,
  ],
})
export class AppModule {}
