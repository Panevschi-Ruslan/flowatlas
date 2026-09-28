import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { LegacyController } from './legacy/legacy.controller';
import { ReportsController } from './reports/reports.controller';

@Module({
  controllers: [HealthController, LegacyController, ReportsController],
})
export class AppModule {}
