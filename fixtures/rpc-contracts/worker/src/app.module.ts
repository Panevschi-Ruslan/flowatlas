import { Module } from '@nestjs/common';
import { ArchiveClient } from './archive.client';
import { BillingModule } from './billing.module';
import { FulfilController } from './fulfil.controller';
import { LedgerClient } from './ledger.client';
import { OrdersClient } from './orders.client';

@Module({
  imports: [BillingModule],
  controllers: [FulfilController],
  providers: [OrdersClient, LedgerClient, ArchiveClient],
})
export class AppModule {}
