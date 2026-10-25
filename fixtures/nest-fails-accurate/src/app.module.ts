import { Module } from '@nestjs/common';

import { LoansModule } from './loans/loans.module';
import { ReportsModule } from './reports/reports.module';
import { ReturnsModule } from './returns/returns.module';

@Module({
  imports: [LoansModule, ReturnsModule, ReportsModule],
})
export class AppModule {}
