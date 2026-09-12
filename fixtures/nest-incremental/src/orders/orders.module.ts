import { Module } from '@nestjs/common';

import { BillingClient } from '../billing/billing.client';
import { BILLING_CLIENT } from '../shared/tokens';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrdersRepository,
    { provide: BILLING_CLIENT, useClass: BillingClient },
  ],
})
export class OrdersModule {}
