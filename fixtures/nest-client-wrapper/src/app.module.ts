import { Module } from '@nestjs/common';
import { OrdersService } from './orders/orders.service.js';
import { BillingService } from './orders/billing.service.js';

@Module({ providers: [OrdersService, BillingService] })
export class AppModule {}
