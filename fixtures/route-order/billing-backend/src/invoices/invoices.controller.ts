import { Controller, Get, Param } from '@nestjs/common';

export interface Invoice {
  id: string;
  due: string;
}

@Controller('invoices')
export class InvoicesController {
  @Get(':invoiceId')
  findOne(@Param('invoiceId') invoiceId: string): Invoice {
    return { id: invoiceId, due: '' };
  }

  /** Declared below `:invoiceId`, and still reached: on Fastify the spelled-out route wins. */
  @Get('overdue')
  overdue(): Invoice[] {
    return [];
  }
}
