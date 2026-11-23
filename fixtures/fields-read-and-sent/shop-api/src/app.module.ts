import { Module } from '@nestjs/common';
import { ClientGuard } from './auth/client.guard';
import { EventBus } from './bus/event-bus';
import { DeskController } from './desk/desk.controller';
import { DeskService } from './desk/desk.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [OrdersController, DeskController],
  providers: [OrdersService, DeskService, EventBus, ClientGuard],
})
export class AppModule {}
