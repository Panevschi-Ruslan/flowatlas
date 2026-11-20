import { Module } from '@nestjs/common';

import { BoardsController } from './boards/boards.controller';
import { BoardsService } from './boards/boards.service';
import { CardEventsService } from './boards/card-events.service';
import { OrdersService } from './boards/orders.service';
import { BoardEventBus } from './bus/board-event-bus';
import { BusService } from './bus/bus.service';

@Module({
  controllers: [BoardsController],
  providers: [BusService, BoardEventBus, BoardsService, CardEventsService, OrdersService],
})
export class AppModule {}
