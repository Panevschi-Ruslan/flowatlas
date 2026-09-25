import { Controller, Delete, Get, Post } from '@nestjs/common';

import { InvoicesService } from './invoices.service.js';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  findAll(): Promise<unknown[]> {
    return this.invoices.findAll();
  }

  @Post()
  create(): Promise<unknown> {
    return this.invoices.create(100);
  }

  @Delete()
  remove(): Promise<number> {
    return this.invoices.remove('1');
  }
}
