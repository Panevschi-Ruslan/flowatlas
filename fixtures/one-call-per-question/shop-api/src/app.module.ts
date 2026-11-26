import { Module } from '@nestjs/common';
import { ClientGuard } from './auth/client.guard';
import { EventBus } from './bus/event-bus';
import { DeskController } from './desk/desk.controller';
import { DeskService } from './desk/desk.service';
import { FloorController } from './floor/floor.controller';
import { FloorService } from './floor/floor.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [OrdersController, DeskController, FloorController],
  providers: [OrdersService, DeskService, FloorService, EventBus, ClientGuard],
})
export class AppModule {}
