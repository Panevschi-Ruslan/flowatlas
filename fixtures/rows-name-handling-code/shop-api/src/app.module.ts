import { Module } from '@nestjs/common';

import { ClientGuard } from './auth/client.guard';
import { NoteGuard } from './auth/note.guard';
import { StaffBot } from './bot/staff-bot.service';
import { EventsService } from './bus/events.service';
import { DeskController } from './desk/desk.controller';
import { DeskService } from './desk/desk.service';
import { AlertRelay } from './notify/alert-relay.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { StreamController } from './stream/stream.controller';

@Module({
  controllers: [OrdersController, DeskController, StreamController],
  providers: [EventsService, OrdersService, DeskService, StaffBot, AlertRelay, ClientGuard, NoteGuard],
})
export class AppModule {}
