import { Body, Controller, Post } from '@nestjs/common';

import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** What `orders` asks for over `BILLING_URL`. */
  @Post()
  create(@Body() body: { orderId: string }): Promise<unknown> {
    return this.invoices.create(body.orderId);
  }
}
