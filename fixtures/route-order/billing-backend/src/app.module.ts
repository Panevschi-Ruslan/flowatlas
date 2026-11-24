import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices/invoices.controller';

@Module({
  controllers: [InvoicesController],
})
export class AppModule {}
