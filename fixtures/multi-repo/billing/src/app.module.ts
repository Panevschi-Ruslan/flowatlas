import { Module } from '@nestjs/common';

import { InvoicesConsumer } from './invoices/invoices.consumer';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';

@Module({
  controllers: [InvoicesController, InvoicesConsumer],
  providers: [InvoicesService],
})
export class AppModule {}
