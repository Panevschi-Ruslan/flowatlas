import { Module } from '@nestjs/common';

import { AuditJob } from './cleanup/audit.job';
import { AuditService } from './cleanup/audit.service';
import { CleanupCronJob, ReportCronJob } from './cleanup/cleanup.cron.job';
import { CleanupScheduler } from './cleanup/cleanup.scheduler';
import { BuildExportJob } from './exports/build-export.job';
import { ExportsController } from './exports/exports.controller';
import { SendMailJob } from './mail/send-mail.job';
import { WelcomeService } from './mail/welcome.service';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [ExportsController],
  providers: [
    BuildExportJob,
    SendMailJob,
    CleanupCronJob,
    ReportCronJob,
    AuditJob,
    WelcomeService,
    CleanupScheduler,
    AuditService,
  ],
})
export class AppModule {}
