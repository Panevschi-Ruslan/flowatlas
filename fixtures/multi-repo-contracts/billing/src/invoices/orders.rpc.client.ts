import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import type { GetOrderQuery, OrderDto } from './dto';

/** The asking half of the rpc pair, and the reader of its answer. */
@Injectable()
export class OrdersRpcClient {
  constructor(
    @Inject('ORDERS_CLIENT')
    private readonly orders: ClientProxy,
  ) {}

  ask(query: GetOrderQuery): Observable<OrderDto> {
    return this.orders.send<OrderDto, GetOrderQuery>('orders.get', query);
  }
}
