import { Module } from '@nestjs/common';

import { EventBus } from './bus/event-bus.service';
import { LifecycleProjections } from './projections/lifecycle.service';

@Module({
  providers: [EventBus, LifecycleProjections],
})
export class AppModule {}
