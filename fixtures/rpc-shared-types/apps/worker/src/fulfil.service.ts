import { Inject, Injectable } from '@nestjs/common';
import { LEDGER_CLIENT, ORDERS_CLIENT, type OrdersClient } from '@shop/clients';

/**
 * Handed the clients the shared package's modules provide, by their tokens.
 * The orders client is typed from the shared tree, so what each call hands
 * and reads back is compared with the procedure's; the ledger one is `any`.
 */
@Injectable()
export class FulfilService {
  constructor(
    @Inject(ORDERS_CLIENT) private readonly orders: OrdersClient,
    @Inject(LEDGER_CLIENT) private readonly ledger: any,
  ) {}

  async fulfil(sku: string, quantity: number) {
    const placed = await this.orders.orders.place.mutate({ sku, quantity });
    await this.ledger.entries.record.mutate({ orderId: placed.id, amount: quantity });
    return this.orders.orders.get.query({ id: placed.id });
  }
}
