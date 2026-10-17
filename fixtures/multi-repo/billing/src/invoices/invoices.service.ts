import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { CreateInvoiceDto, InvoiceDto } from './invoice.dto';

/**
 * No store: billing keeps its invoices in memory, which is enough here. The two
 * throws are what `POST /invoices` and `GET /invoices/:id` declare they fail
 * with (P106): the traces answer the 404 and never the 409.
 */
@Injectable()
export class InvoicesService {
  private readonly rows = new Map<string, InvoiceDto>();

  create(body: CreateInvoiceDto): InvoiceDto {
    if (this.rows.has(`inv-${body.orderId}`)) throw new ConflictException('already invoiced');
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
    const invoice = this.rows.get(id);
    if (invoice === undefined) throw new NotFoundException(id);
    return invoice;
  }
}
