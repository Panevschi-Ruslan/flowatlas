import { Module } from '@nestjs/common';

import { ChargesController } from './charges/charges.controller';
import { ChargesService } from './charges/charges.service';

@Module({
  controllers: [ChargesController],
  providers: [ChargesService],
})
export class AppModule {}
