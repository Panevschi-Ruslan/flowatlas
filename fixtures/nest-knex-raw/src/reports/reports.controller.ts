import { Controller, Get } from '@nestjs/common';

import { ReportsService } from './reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('open')
  open(): Promise<unknown> {
    return this.reports.open('open');
  }

  @Get('large')
  large(): Promise<unknown[]> {
    return this.reports.large(100);
  }
}
