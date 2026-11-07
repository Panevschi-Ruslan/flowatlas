import { Controller, Param, Post } from '@nestjs/common';
import { ArchiveClient } from './archive.client';
import { BillingService } from './billing.service';
import { LedgerClient } from './ledger.client';
import { OrdersClient } from './orders.client';

/** The way in that reaches every client. */
@Controller('fulfil')
export class FulfilController {
  constructor(
    private readonly orders: OrdersClient,
    private readonly billing: BillingService,
    private readonly ledger: LedgerClient,
    private readonly archive: ArchiveClient,
  ) {}

  @Post(':sku')
  async fulfil(@Param('sku') sku: string) {
    const placed = await this.orders.place(sku, 1);
    await this.orders.find(placed.id);
    await this.orders.count();
    await this.billing.invoice(placed.id);
    await this.billing.void(placed.id);
    await this.ledger.record(placed.id, placed.total);
    await this.archive.store(placed.id);
    return this.billing.invoicesOf(placed.id);
  }
}
