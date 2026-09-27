import { Module } from '@nestjs/common';

import { EventBus } from './bus/event-bus.service';
import { DeclaredProjections } from './projections/declared-projections.service';
import { OrderProjections } from './projections/orders.service';

@Module({
  providers: [EventBus, OrderProjections, DeclaredProjections],
})
export class AppModule {}
