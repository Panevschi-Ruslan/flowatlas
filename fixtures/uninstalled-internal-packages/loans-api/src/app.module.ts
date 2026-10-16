import { Module } from '@nestjs/common';

import { LoansController } from './loans/loans.controller';
import { LoansService } from './loans/loans.service';

@Module({
  controllers: [LoansController],
  providers: [LoansService],
})
export class AppModule {}
