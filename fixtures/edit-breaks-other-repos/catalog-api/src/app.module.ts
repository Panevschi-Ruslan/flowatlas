import { Module } from '@nestjs/common';
import { EventBus } from './bus/event-bus';
import { ItemsController, TagsController } from './items/items.controller';
import { ItemsService } from './items/items.service';

@Module({
  controllers: [ItemsController, TagsController],
  providers: [ItemsService, EventBus],
})
export class AppModule {}
