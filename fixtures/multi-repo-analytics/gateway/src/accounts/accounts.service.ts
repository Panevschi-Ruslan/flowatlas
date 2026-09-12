import { Injectable } from '@nestjs/common';

import { OrdersClient } from '../clients/orders.client';

/**
 * The hop that closes the cycle.
 *
 * An account is answered with the customer's recent orders, and `orders`
 * answers a recent order with the account it belongs to. Each side is
 * reasonable on its own and neither repository can see the loop.
 */
@Injectable()
export class AccountsService {
  constructor(private readonly orders: OrdersClient) {}

  async find(id: string): Promise<unknown> {
    const recent = await this.orders.recent(id);
    return { id, recent };
  }
}
