import { Controller, Get, Param, Post } from '@nestjs/common';

/** The admin's kits: each path names the tenant by `:tenantId`, which a list of the routes should say. */
@Controller('api/admin/:tenantId/kits')
export class KitsController {
  @Get('auto-stopped')
  autoStopped(@Param('tenantId') tenantId: string): string[] {
    return [tenantId];
  }

  @Post(':kitId/restart')
  restart(@Param('tenantId') tenantId: string, @Param('kitId') kitId: string): void {
    void tenantId;
    void kitId;
  }
}
