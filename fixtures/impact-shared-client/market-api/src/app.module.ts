import { Module } from '@nestjs/common';
import { BundlesController } from './bundles.controller';
import { DesksController } from './desks.controller';
import { DesksService } from './desks.service';
import { EventsService } from './events.service';
import { FallbackController } from './fallback.controller';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { LiveController } from './live.controller';

@Module({
  controllers: [ItemsController, DesksController, BundlesController, LiveController, FallbackController],
  providers: [ItemsService, DesksService, EventsService],
})
export class AppModule {}
