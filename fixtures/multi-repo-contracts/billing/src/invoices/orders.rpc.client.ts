import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import type { GetOrderQuery } from './dto';

/** The asking half of the rpc pair. */
@Injectable()
export class OrdersRpcClient {
  constructor(
    @Inject('ORDERS_CLIENT')
    private readonly orders: ClientProxy,
  ) {}

  ask(query: GetOrderQuery): unknown {
    return this.orders.send('orders.get', query);
  }
}
