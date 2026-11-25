import { Module } from '@nestjs/common';
import { DeskBot } from './desk-bot';
import { DeskBotController } from './desk-bot.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController, DeskBotController],
  providers: [OrdersService, DeskBot],
})
export class AppModule {}
