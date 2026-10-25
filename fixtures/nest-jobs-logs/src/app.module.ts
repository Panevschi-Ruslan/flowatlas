import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { CleanupService } from './cleanup.service';
import { DraftsStore } from './drafts.store';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [CleanupService, DraftsStore],
})
export class AppModule {}
