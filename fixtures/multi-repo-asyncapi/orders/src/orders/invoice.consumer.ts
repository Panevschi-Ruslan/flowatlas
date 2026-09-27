import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { InvoiceIssued } from './order.dto';

/**
 * The other direction: a channel this repository listens to, whose publisher is
 * only a document.
 *
 * `amount` is text here and a number over there, which is a disagreement the
 * contract check reports against a declared end exactly as it would against a
 * read one — and it says which half was believed while it does.
 */
@Controller()
export class InvoiceConsumer {
  @EventPattern('invoice.issued')
  issued(@Payload() event: InvoiceIssued): void {
    void event.invoiceId;
  }
}
