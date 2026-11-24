import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { NotifyService } from './notify.service';

@Module({
  providers: [NotifyService, AuditService],
})
export class AppModule {}
