import { Injectable } from '@nestjs/common';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

/**
 * The orders service's oRPC client, kept on the provider that uses it. The
 * link is rooted at ORDERS_URL, which the orders service claims as its base,
 * so every call here joins a procedure of orders.
 */
@Injectable()
export class OrdersClient {
  private readonly orders = createORPCClient<any>(new RPCLink({ url: `${process.env.ORDERS_URL}/rpc` }));

  place(sku: string, quantity: number) {
    return this.orders.orders.place({ sku, quantity });
  }

  find(id: string) {
    return this.orders.orders.get({ id });
  }

  /** A procedure orders does not declare. */
  audit(id: string) {
    return this.orders.orders.audit({ id });
  }
}
