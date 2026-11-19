import { Module } from '@nestjs/common';

import { ReportsResolver } from './reports.resolver';

@Module({
  providers: [ReportsResolver],
})
export class ReportsModule {}
