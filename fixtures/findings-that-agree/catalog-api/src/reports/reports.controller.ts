import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { TotalsInterceptor } from './totals.interceptor';

/** One day of orders, as the handler declares it. */
export interface DailyReport {
  date: string;
  orders: number;
}

@Controller('reports')
@UseInterceptors(TotalsInterceptor)
export class ReportsController {
  @Get('daily')
  daily(): DailyReport {
    return { date: '2026-01-01', orders: 3 };
  }
}
