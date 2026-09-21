import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { OrderDto } from '@fx/contracts';

import { BillingClient } from '../clients/billing.client';
import { OrdersClient } from '../clients/orders.client';
import { PaymentsClient } from '../clients/payments.client';

/**
 * Every entry this repository has. Nothing in the project calls them — the
 * caller is `web`, which has no extractor until P08 — so all five land in
 * `routes.uncalled`, which is why §12 asks only that the list *contains*
 * billing's uncalled route.
 *
 * `GET /orders/:id` is the head of the chain §12 walks end to end:
 * `entry:gateway:http:GET:/orders/:param` -> `OrdersController.findOne` ->
 * `OrdersClient.fetchOne` -> `http_out` -> (`http_calls`)
 * `entry:orders:http:GET:/orders/:param` -> `OrdersController.findOne` ->
 * `OrdersService.findOne` -> `db_query` -> `table:orders#Order`. That is eight
 * hops, so `traverse()` needs `maxDepth: 8`; the default of 6 stops two short.
 */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersClient,
    private readonly billing: BillingClient,
    private readonly payments: PaymentsClient,
  ) {}

  @Get(':id')
  findOne(@Param('id') id: string): { data: unknown } {
    return this.orders.fetchOne(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): { data: unknown } {
    return this.orders.cancel(id);
  }

  @Post(':id/invoice')
  invoice(@Body() order: OrderDto): { data: unknown } {
    return this.billing.requestInvoice(order);
  }

  @Post('pay')
  pay(@Body() order: OrderDto): { data: unknown } {
    return this.payments.pay(order);
  }

  @Post('charge')
  charge(@Body() order: OrderDto): Promise<unknown> {
    return this.payments.charge(order);
  }

  /**
   * Two routes one browser call reaches, one per value of a closed segment
   * (R31). `ship` and `refund` are spelled out; `/orders/:param/:param`
   * matches neither, which is the reading that has to be improved on.
   */
  @Post(':id/ship')
  ship(@Param('id') id: string): { data: unknown } {
    return this.orders.cancel(id);
  }

  @Post(':id/refund')
  refund(@Param('id') id: string): { data: unknown } {
    return this.orders.cancel(id);
  }

  /** The half of the same pair that exists: `hold` has no route, on purpose. */
  @Post(':id/resume')
  resume(@Param('id') id: string): { data: unknown } {
    return this.orders.cancel(id);
  }
}
