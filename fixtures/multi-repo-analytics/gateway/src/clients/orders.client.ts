import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/** Every call this repository makes to `orders`, all rooted at `ORDERS_URL`. */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** One of the four calls that make `POST /orders/create` the hotspot. */
  create(customerId: string): { data: unknown } {
    return this.http.post(`${this.config.get('ORDERS_URL')}/orders/create`, { customerId });
  }

  /** The second one, from the same repository: a draft is still a create. */
  createDraft(customerId: string): { data: unknown } {
    return this.http.post(`${this.config.get('ORDERS_URL')}/orders/create`, {
      customerId,
      draft: true,
    });
  }

  recent(customerId: string): { data: unknown } {
    return this.http.get(`${this.config.get('ORDERS_URL')}/orders/recent`, { customerId });
  }
}
