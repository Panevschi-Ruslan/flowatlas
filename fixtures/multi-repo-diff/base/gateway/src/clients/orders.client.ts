import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { CreateOrderDto, OrderDto } from './dto';

/**
 * The call `flowatlas.config.json` ties to `orders` through `ORDERS_URL`.
 *
 * Without that setting there is no boundary and nothing to check: the linker
 * would see a request going somewhere and no route to compare it against.
 */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  create(body: CreateOrderDto): { data: unknown } {
    return this.http.post<OrderDto>(`${this.config.get('ORDERS_URL')}/orders`, body);
  }
}
