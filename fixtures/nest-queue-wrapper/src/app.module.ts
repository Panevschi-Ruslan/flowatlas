import { Module } from '@nestjs/common';

import { AuditJob } from './cleanup/audit.job';
import { CleanupCronJob, ReportCronJob } from './cleanup/cleanup.cron.job';
import { BuildExportJob } from './exports/build-export.job';
import { SendMailJob } from './mail/send-mail.job';

@Module({
  providers: [BuildExportJob, SendMailJob, CleanupCronJob, ReportCronJob, AuditJob],
})
export class AppModule {}
