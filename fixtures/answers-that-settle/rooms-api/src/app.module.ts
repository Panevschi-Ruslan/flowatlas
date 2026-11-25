import { Module } from '@nestjs/common';

import { VenueBus } from './bus/venue-bus.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { RoomsController } from './rooms/rooms.controller';
import { RoomsService } from './rooms/rooms.service';

@Module({
  controllers: [RoomsController, OrdersController],
  providers: [VenueBus, RoomsService, OrdersService],
})
export class AppModule {}
