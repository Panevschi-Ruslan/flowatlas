import { Module } from '@nestjs/common';

import { JobBus } from './jobs/job-bus.service';
import { DigestQueue, MailQueue, TenantQueue } from './jobs/queues';
import { OrdersService } from './orders/orders.service';

@Module({
  providers: [JobBus, MailQueue, DigestQueue, TenantQueue, OrdersService],
})
export class AppModule {}
