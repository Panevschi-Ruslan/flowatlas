import { Module } from '@nestjs/common';

import { Broadcaster } from './events/broadcaster.service';
import { EVENT_PUBLISHER } from './events/event-publisher';
import { EventBus } from './events/event-bus.service';
import { Metrics } from './events/metrics.service';
import { EventsController } from './orders/events.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [OrdersController, EventsController],
  providers: [
    Broadcaster,
    EventBus,
    Metrics,
    OrdersService,
    // The bus is injected by token, so every publishing call site sees the
    // interface rather than the class.
    { provide: EVENT_PUBLISHER, useExisting: Broadcaster },
  ],
})
export class AppModule {}
