import { Controller, Get } from '@nestjs/common';

import { REPORTS_BUCKET } from './settings';

/** Where today's report is. */
@Controller('reports')
export class ReportsController {
  @Get('today')
  today(): { bucket: string } {
    return { bucket: REPORTS_BUCKET };
  }
}
