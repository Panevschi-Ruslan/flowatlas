import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { BooksModule } from './books/books.module';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { OrdersModule } from './orders/orders.module';
import { ReportsModule } from './reports/reports.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [BooksModule, OrdersModule, ReportsModule, StatsModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
