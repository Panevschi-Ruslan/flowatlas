import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { BillingClient } from '../clients/billing.client';
import { OrdersClient } from '../clients/orders.client';
import { AppLogger } from '../common/app-logger';
import { Metrics } from '../common/metrics';

/** Every route logs and counts before it calls out. */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersClient,
    private readonly billing: BillingClient,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    this.logger.log(`GET /orders/${id}`, 'OrdersController');
    this.metrics.count('gateway.find');
    return this.orders.fetchOne(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    this.logger.log(`POST /orders/${id}/cancel`, 'OrdersController');
    this.metrics.count('gateway.cancel');
    return this.orders.cancel(id);
  }

  /** `POST /orders/:param/invoice`: the flow §1 of P92 asks to reach `billing`'s `POST /invoices`. */
  @Post(':id/invoice')
  invoice(@Param('id') id: string, @Body() body: { amount: number }) {
    this.logger.log(`POST /orders/${id}/invoice`, 'OrdersController');
    this.metrics.count('gateway.invoice');
    return this.billing.requestInvoice(id, body.amount);
  }
}
