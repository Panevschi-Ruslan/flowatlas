import { Body, Controller, Post } from '@nestjs/common';

import type { CreateInvoiceDto } from './dto';

@Controller('invoices')
export class InvoicesController {
  @Post()
  create(@Body() body: CreateInvoiceDto): { id: string } {
    return { id: `inv-${body.orderId}` };
  }
}
