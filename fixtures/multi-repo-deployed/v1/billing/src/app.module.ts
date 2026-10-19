import { Module } from '@nestjs/common';

import { InvoicesController } from './invoices/invoices.controller';
import { PlacedConsumer } from './invoices/placed.consumer';

@Module({
  controllers: [InvoicesController, PlacedConsumer],
})
export class AppModule {}
