import { Injectable } from '@nestjs/common';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { OrdersApi, PlacedOrder } from './orders.api';

/**
 * The orders client, typed by the worker's own copy of the tree. Each call
 * hands an input and reads an answer of the copy's types, which are compared
 * with what the orders procedures declare.
 */
@Injectable()
export class OrdersClient {
  private readonly orders: OrdersApi = createORPCClient<OrdersApi>(new RPCLink({ url: `${process.env.ORDERS_URL}/rpc` }));

  /** Drifted: `qty` for `quantity`, and a `total` nothing answers. */
  place(sku: string, quantity: number): Promise<PlacedOrder> {
    return this.orders.orders.place({ sku, qty: quantity });
  }

  /** Agrees with the procedure on both ends. */
  find(id: string) {
    return this.orders.orders.get({ id });
  }

  /** The procedure declares no input, so what is sent is not compared. */
  count() {
    return this.orders.orders.count({ since: '2026-01-01' });
  }
}
