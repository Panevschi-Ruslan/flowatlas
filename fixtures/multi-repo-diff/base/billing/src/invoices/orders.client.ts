import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { CreateOrderDto } from './dto';

@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  create(body: CreateOrderDto): { data: unknown } {
    return this.http.post(`${this.config.get('ORDERS_URL')}/orders`, body);
  }
}
