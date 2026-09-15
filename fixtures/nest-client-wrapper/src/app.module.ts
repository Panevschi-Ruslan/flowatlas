import { Module } from '@nestjs/common';
import { OrdersService } from './orders/orders.service.js';
import { BillingService } from './orders/billing.service.js';
import { NotifierService } from './orders/notifier.service.js';

@Module({ providers: [OrdersService, BillingService, NotifierService] })
export class AppModule {}
