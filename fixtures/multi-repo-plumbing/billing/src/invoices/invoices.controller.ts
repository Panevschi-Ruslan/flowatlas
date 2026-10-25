import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateInvoiceDto, InvoiceDto } from './invoice.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** `POST /invoices`: where the gateway's `POST /orders/:param/invoice` ends. */
  @Post()
  create(@Body() body: CreateInvoiceDto): InvoiceDto {
    return this.invoices.create(body);
  }

  @Get(':id')
  findOne(@Param('id') id: string): InvoiceDto | undefined {
    return this.invoices.findOne(id);
  }
}
