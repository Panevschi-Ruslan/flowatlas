import { Module } from '@nestjs/common';

import { OrdersClient } from './orders/orders.client';

@Module({
  providers: [OrdersClient],
})
export class AppModule {}
