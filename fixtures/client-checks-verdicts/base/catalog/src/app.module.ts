import { Module } from '@nestjs/common';
import { EventBus } from './bus/event-bus';
import { ItemsController } from './items/items.controller';
import { ItemsService } from './items/items.service';

@Module({
  controllers: [ItemsController],
  providers: [EventBus, ItemsService],
})
export class AppModule {}
