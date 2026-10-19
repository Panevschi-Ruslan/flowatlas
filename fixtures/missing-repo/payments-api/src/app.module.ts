import { Module } from '@nestjs/common';

import { ChargesController } from './charges.controller';
import { PaymentsConsumer } from './payments.consumer';

@Module({
  controllers: [ChargesController, PaymentsConsumer],
})
export class AppModule {}
