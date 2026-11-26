import { Controller, Param, Post } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('shops/:shopId')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Post('audit/:entryId')
  record(@Param('shopId') shopId: string, @Param('entryId') entryId: string): Promise<void> {
    return this.audit.record(shopId, entryId);
  }

  @Post('alerts/:alertId')
  alert(@Param('shopId') shopId: string, @Param('alertId') alertId: string): Promise<void> {
    return this.audit.alert(shopId, alertId);
  }
}
