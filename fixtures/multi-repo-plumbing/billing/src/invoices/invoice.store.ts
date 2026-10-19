import { Injectable } from '@nestjs/common';

import { AppLogger } from '../common/app-logger';
import type { InvoiceDto } from './invoice.dto';

/** Invoices in memory, read through `findOne` by every service method. */
@Injectable()
export class InvoiceStore {
  private readonly rows = new Map<string, InvoiceDto>();

  constructor(private readonly logger: AppLogger) {}

  findOne(id: string): InvoiceDto | undefined {
    this.logger.log(`read ${id}`, 'InvoiceStore');
    return this.rows.get(id);
  }

  put(invoice: InvoiceDto): InvoiceDto {
    this.logger.log(`write ${invoice.id}`, 'InvoiceStore');
    this.rows.set(invoice.id, invoice);
    return invoice;
  }
}
