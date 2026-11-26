import { Module } from '@nestjs/common';
import { BotService } from './bot/bot.service';
import { EventsController } from './events/events.controller';
import { FloorWatcher } from './floor/floor.watcher';
import { NotifyService } from './notify/notify.service';
import { ShopClient } from './shop.client';

@Module({
  controllers: [EventsController],
  providers: [BotService, NotifyService, FloorWatcher, ShopClient],
})
export class AppModule {}
