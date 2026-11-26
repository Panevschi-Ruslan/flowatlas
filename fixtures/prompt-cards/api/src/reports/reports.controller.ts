import { Controller, Get } from '@nestjs/common';

/** A route no repository calls: what `dead({service})` lists. */
@Controller('reports')
export class ReportsController {
  @Get('daily')
  daily(): string[] {
    return [];
  }
}
