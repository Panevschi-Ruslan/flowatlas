import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { CatalogController } from './catalog/catalog.controller';
import { EventsController } from './events/events.controller';
import { TasksService } from './tasks/tasks.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [CatalogController, EventsController],
  providers: [TasksService],
})
export class AppModule {}
