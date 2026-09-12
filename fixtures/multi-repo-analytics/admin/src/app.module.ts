import { Module } from '@nestjs/common';

import { OrdersClient } from './clients/orders.client';
import { SyncJob } from './sync/sync.job';

@Module({
  providers: [SyncJob, OrdersClient],
})
export class AppModule {}
