import { Module } from '@nestjs/common';

import { EventBusService } from './bus/event-bus.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { ProjectionsService } from './orders/projections.service';

@Module({
  controllers: [OrdersController],
  providers: [EventBusService, OrdersService, ProjectionsService],
})
export class AppModule {}
