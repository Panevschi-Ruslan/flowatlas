import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { ReportBuilder } from './reports/report.builder';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { StockJobs } from './stock/stock.jobs';
import { StockService } from './stock/stock.service';

@Module({
  controllers: [CheckoutController, ReportsController],
  providers: [StockService, StockJobs, CheckoutService, ReportsService, ReportBuilder],
})
export class AppModule {}
