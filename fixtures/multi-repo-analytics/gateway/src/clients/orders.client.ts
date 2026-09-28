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
  create(customerId: string) {
    return this.http.post(`${this.config.get('ORDERS_URL')}/orders/create`, { customerId });
  }

  /** The second one, from the same repository: a draft is still a create. */
  createDraft(customerId: string) {
    return this.http.post(`${this.config.get('ORDERS_URL')}/orders/create`, {
      customerId,
      draft: true,
    });
  }

  recent(customerId: string) {
    return this.http.get(`${this.config.get('ORDERS_URL')}/orders/recent`, { customerId });
  }
}

// The request methods above declare no return type on purpose. What a request
// answers with is the library's business — `HttpService.get<T>` gives back
// `Observable<AxiosResponse<T>>` — and letting that signature decide is what
// makes this fixture a test of the library's shape rather than of a shape
// somebody retyped. They used to say `{ data: unknown }`, which no real Nest
// client can say and which hid the delivery wrapper the graph reads through.
//
// Do not put an annotation back. The stub's signature is what decides the type
// here, so an annotation written out by hand would be asserting the copy rather
// than the library, which is exactly how the wrong shape went unnoticed.
