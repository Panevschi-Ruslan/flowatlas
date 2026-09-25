import { Module } from '@nestjs/common';

import { EventBus } from './bus/event-bus.service';
import { OrderProjections } from './projections/orders.service';

@Module({
  providers: [EventBus, OrderProjections],
})
export class AppModule {}
