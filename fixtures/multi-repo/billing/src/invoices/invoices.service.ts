import { Injectable } from '@nestjs/common';

import type { CreateInvoiceDto, InvoiceDto } from './invoice.dto';

/** No store: billing keeps its invoices in memory, which is enough here. */
@Injectable()
export class InvoicesService {
  private readonly rows = new Map<string, InvoiceDto>();

  create(body: CreateInvoiceDto): InvoiceDto {
    const invoice: InvoiceDto = {
      id: `inv-${body.orderId}`,
      orderId: body.orderId,
      amount: body.amount,
      status: 'open',
    };
    this.rows.set(invoice.id, invoice);
    return invoice;
  }

  findOne(id: string): InvoiceDto {
    return this.rows.get(id);
  }
}
