import { Controller, Get, UseFilters } from '@nestjs/common';

import { PickedStatusFilter } from './picked-status.filter';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseFilters(PickedStatusFilter)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overdue')
  overdue() {
    return this.reports.overdue();
  }
}
