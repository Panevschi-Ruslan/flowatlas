import { Module } from '@nestjs/common';

import { ReminderJob } from './jobs/reminder.job';
import { NotifyService } from './notify/notify.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { PricingService } from './pricing/pricing.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, NotifyService, PricingService, ReminderJob],
})
export class AppModule {}
