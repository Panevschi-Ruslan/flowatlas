import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices/invoices.controller.js';
import { InvoicesService } from './invoices/invoices.service.js';

@Module({ controllers: [InvoicesController], providers: [InvoicesService] })
export class AppModule {}
