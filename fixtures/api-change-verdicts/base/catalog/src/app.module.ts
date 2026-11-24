import { Module } from '@nestjs/common';
import { EventBus } from './bus/event-bus';
import { DraftsController } from './items/drafts.controller';
import { ItemsController } from './items/items.controller';
import { ItemsService } from './items/items.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

@Module({
  controllers: [ItemsController, DraftsController, StockController],
  providers: [EventBus, ItemsService, StockService],
})
export class AppModule {}
