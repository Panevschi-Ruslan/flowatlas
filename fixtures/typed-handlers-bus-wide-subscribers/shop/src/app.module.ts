import { Module } from '@nestjs/common';

import { EventsService } from './bus/events.service';
import { DeskController } from './desk/desk.controller';
import { DeskService } from './desk/desk.service';
import { DeskWatcher } from './desk/desk-watcher.service';
import { AuditFeed } from './notify/audit-feed.service';
import { MetricsService } from './notify/metrics.service';
import { NotifyService } from './notify/notify.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { StreamController } from './stream/stream.controller';

@Module({
  controllers: [OrdersController, DeskController, StreamController],
  providers: [EventsService, OrdersService, DeskService, NotifyService, AuditFeed, MetricsService, DeskWatcher],
})
export class AppModule {}
