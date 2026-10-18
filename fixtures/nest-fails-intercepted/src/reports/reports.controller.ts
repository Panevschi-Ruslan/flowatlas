import { Controller, Get, UseInterceptors } from '@nestjs/common';

import { QuotaInterceptor } from '../interceptors/quota.interceptor';
import { ReportErrorsInterceptor } from '../interceptors/report-errors.interceptor';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseInterceptors(ReportErrorsInterceptor, QuotaInterceptor)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  sales() {
    return this.reports.sales();
  }
}
