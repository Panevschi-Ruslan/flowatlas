import { Module } from '@nestjs/common';

import { LoansModule } from '../loans/loans.module';
import { ReturnsController } from './returns.controller';

@Module({
  imports: [LoansModule],
  controllers: [ReturnsController],
})
export class ReturnsModule {}
