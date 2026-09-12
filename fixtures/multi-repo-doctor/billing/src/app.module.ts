import { Module } from '@nestjs/common';

import { InvoicesConsumer } from './invoices/invoices.consumer';
import { InvoicesService } from './invoices/invoices.service';

@Module({
  controllers: [InvoicesConsumer],
  providers: [InvoicesService],
})
export class AppModule {}
