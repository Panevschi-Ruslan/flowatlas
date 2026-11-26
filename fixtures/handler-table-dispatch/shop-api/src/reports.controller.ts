import { Controller, Get, Param } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('api/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':kind')
  build(@Param('kind') kind: string): Promise<string> {
    return this.reports.build(kind);
  }
}
