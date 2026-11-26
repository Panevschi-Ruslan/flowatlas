import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { HooksController } from './hooks.controller';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [ItemsController, TicketsController, HooksController, OrdersController],
  providers: [ItemsService, TicketsService, OrdersService, EventsService],
})
export class AppModule {}
