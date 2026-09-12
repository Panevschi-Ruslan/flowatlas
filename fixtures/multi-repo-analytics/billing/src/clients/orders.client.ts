import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/** The third call into `POST /orders/create`, from the second service. */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  create(orderId: string): { data: unknown } {
    return this.http.post(`${this.config.get('ORDERS_URL')}/orders/create`, { orderId });
  }
}
