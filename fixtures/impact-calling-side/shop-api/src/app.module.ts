import { Module } from '@nestjs/common';
import { ArchiveHelper } from './archive-helper';
import { ChatHookController } from './chat-hook.controller';
import { ChatUpdatesService } from './chat-updates.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController, ChatHookController],
  providers: [OrdersService, ChatUpdatesService, ArchiveHelper],
})
export class AppModule {}
