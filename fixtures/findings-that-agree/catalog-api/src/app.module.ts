import { Module } from '@nestjs/common';
import { CatalogBus } from './events/catalog-bus';
import { CatalogEventsController } from './events/catalog-events.controller';
import { CatalogService } from './events/catalog.service';
import { ChatBot } from './chat/chat-bot';
import { ChatHookController } from './chat/chat-hook.controller';
import { ProductsController } from './products/products.controller';
import { ReportsController } from './reports/reports.controller';

@Module({
  controllers: [ProductsController, ReportsController, CatalogEventsController, ChatHookController],
  providers: [CatalogBus, CatalogService, ChatBot],
})
export class AppModule {}
