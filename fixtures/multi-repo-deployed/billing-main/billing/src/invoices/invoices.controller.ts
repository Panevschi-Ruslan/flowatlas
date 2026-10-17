import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import type { CreateInvoiceDto, InvoicePaidEvent } from './dto';

@Controller('invoices')
export class InvoicesController {
  constructor(@Inject('EVENTS_CLIENT') private readonly events: ClientProxy) {}

  @Post()
  create(@Body() body: CreateInvoiceDto): { id: string } {
    const paid: InvoicePaidEvent = { invoiceId: `inv-${body.orderId}`, orderId: body.orderId };
    this.events.emit('invoice.paid', paid);
    return { id: paid.invoiceId };
  }
}
