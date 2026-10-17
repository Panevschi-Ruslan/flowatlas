import { Module } from '@nestjs/common';

import { AppLogger } from './common/app-logger';
import { Metrics } from './common/metrics';
import { InvoiceStore } from './invoices/invoice.store';
import { InvoicesConsumer } from './invoices/invoices.consumer';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';

@Module({
  controllers: [InvoicesController, InvoicesConsumer],
  providers: [AppLogger, Metrics, InvoiceStore, InvoicesService],
})
export class AppModule {}
