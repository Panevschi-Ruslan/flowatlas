import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreateInvoiceDto, InvoiceDto } from './invoice.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /**
   * The target the gateway's `@CallsService('billing', 'POST /invoices')` names.
   * `entry:billing:http:POST:/invoices` — the only route in the project reached
   * by a `marker` edge rather than by a base URL.
   */
  @Post()
  create(@Body() body: CreateInvoiceDto): InvoiceDto {
    return this.invoices.create(body);
  }

  /**
   * Nothing calls it. Expected: `routes.uncalled` contains
   * `entry:billing:http:GET:/invoices/:param` (§12) — the check that a route
   * with no incoming `http_calls` is reported rather than assumed to be reached
   * from somewhere unseen.
   */
  @Get(':id')
  findOne(@Param('id') id: string): InvoiceDto {
    return this.invoices.findOne(id);
  }
}
