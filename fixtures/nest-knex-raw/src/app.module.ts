import { Module } from '@nestjs/common';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class AppModule {}
