import { Module } from '@nestjs/common';

import { OrdersConsumer } from './orders/orders.consumer';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [OrdersConsumer],
  providers: [OrdersService],
})
export class OrdersModule {}
