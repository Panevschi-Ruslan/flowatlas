import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import type { CreateInvoiceDto, InvoiceDto } from './invoice.dto';
import { OrderRow } from './order-row.entity';

/** Billing keeps its invoices in memory, and marks the order invoiced in a table it does not own. */
@Injectable()
export class InvoicesService {
  private readonly rows = new Map<string, InvoiceDto>();

  constructor(
    @InjectRepository(OrderRow)
    private readonly orders: Repository<OrderRow>,
  ) {}

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

  /**
   * A write to `orders`, which only `orders` may make: the one violation of
   * `only-orders-writes-orders`.
   */
  async markInvoiced(orderId: string): Promise<void> {
    await this.orders.save({ id: orderId, status: 'invoiced' } as OrderRow);
  }

  findOne(id: string): InvoiceDto {
    return this.rows.get(id);
  }
}
