import { Injectable } from '@nestjs/common';

import { AppLogger } from '../common/app-logger';
import { Metrics } from '../common/metrics';
import type { CreateInvoiceDto, InvoiceDto } from './invoice.dto';
import { InvoiceStore } from './invoice.store';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly store: InvoiceStore,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  create(body: CreateInvoiceDto): InvoiceDto {
    this.logger.log(`invoice ${body.orderId}`, 'InvoicesService');
    this.metrics.count('invoices.create');
    const existing = this.store.findOne(`inv-${body.orderId}`);
    return existing ?? this.store.put({ id: `inv-${body.orderId}`, orderId: body.orderId, amount: body.amount, status: 'open' });
  }

  findOne(id: string): InvoiceDto | undefined {
    this.logger.log(`find ${id}`, 'InvoicesService');
    this.metrics.count('invoices.find');
    return this.store.findOne(id);
  }
}
