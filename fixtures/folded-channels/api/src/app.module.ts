import { Module } from '@nestjs/common';

import { EventBus } from './bus/event-bus.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [OrdersController],
  providers: [EventBus, OrdersService],
})
export class AppModule {}
