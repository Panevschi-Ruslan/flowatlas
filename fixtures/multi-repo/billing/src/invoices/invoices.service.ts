import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import type { CreateInvoiceDto, InvoiceDto, OrderView } from './invoice.dto';

/**
 * No store: billing keeps its invoices in memory, which is enough here. The two
 * throws are what `POST /invoices` and `GET /invoices/:id` declare they fail
 * with (P106): the traces answer the 404 and never the 409.
 */
@Injectable()
export class InvoicesService {
  private readonly rows = new Map<string, InvoiceDto>();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Billing's one outgoing call (P209): it reads the order it invoices from
   * `orders`, through the base URL the configuration gives `orders`. So this
   * becomes `http_calls` -> `entry:orders:http:GET:/orders/:param`, confidence
   * `static`, `meta.via: "baseUrlEnv"`, the same route the gateway's
   * `OrdersClient.fetchOne` reaches. Every way into billing that writes an
   * invoice - `POST /invoices` and both consumers - goes through it.
   */
  async create(body: CreateInvoiceDto): Promise<InvoiceDto> {
    if (this.rows.has(`inv-${body.orderId}`)) throw new ConflictException('already invoiced');
    const { data: order } = await firstValueFrom(
      this.http.get<OrderView>(`${this.config.get('ORDERS_URL')}/orders/${body.orderId}`),
    );
    const invoice: InvoiceDto = {
      id: `inv-${order.id}`,
      orderId: order.id,
      amount: body.amount,
      status: order.status === 'paid' ? 'paid' : 'open',
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
