import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_CLIENT, LEDGER_CLIENT, ORDERS_CLIENT } from '@shop/clients';

/**
 * Handed the clients by their tokens: two a configuring method of the shared
 * package provides, one the application's own module provides through the
 * package's function. `REPORTS_CLIENT` nobody provides.
 */
@Injectable()
export class FulfilService {
  constructor(
    @Inject(ORDERS_CLIENT) private readonly orders: any,
    @Inject(LEDGER_CLIENT) private readonly ledger: any,
    @Inject(AUDIT_CLIENT) private readonly audit: { label: string },
    @Inject('REPORTS_CLIENT') private readonly reports: any,
  ) {}

  async fulfil(sku: string, quantity: number) {
    const placed = await this.orders.orders.place.mutate({ sku, quantity });
    await this.ledger.entries.record.mutate({ orderId: placed.id, amount: quantity });
    return { ...placed, by: this.audit.label, reported: this.reports !== undefined };
  }
}
