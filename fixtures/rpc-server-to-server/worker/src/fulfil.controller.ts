import { Controller, Param, Post } from '@nestjs/common';
import { BillingClient } from './billing.client';
import { OrdersClient } from './orders.client';
import { refundInvoice } from './refunds';

/** The way in that reaches every client: an order is placed, billed and, on request, refunded. */
@Controller('fulfil')
export class FulfilController {
  constructor(
    private readonly orders: OrdersClient,
    private readonly billing: BillingClient,
  ) {}

  @Post(':sku')
  async fulfil(@Param('sku') sku: string) {
    const placed = await this.orders.place(sku, 1);
    await this.billing.invoice(placed.id);
    return this.billing.invoicesOf(placed.id);
  }

  @Post(':invoiceId/refund')
  refund(@Param('invoiceId') invoiceId: string) {
    return refundInvoice(invoiceId);
  }
}
