import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import type { OrderDto } from '@fx/contracts';

/** The two addresses that leave the project altogether. */
@Injectable()
export class PaymentsClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * No service in `flowatlas.config.json` declares `PAYMENTS_URL`, so the address
   * names a repository this project does not contain (or a configuration gap).
   * Expected: no edge, `http_out.meta.targetService: null`, unresolved
   * `unknown-base-url-env`, hint "add `PAYMENTS_URL` to `services[].baseUrlEnv`
   * of the target service in flowatlas.config.json" (§10, row 2).
   */
  pay(order: OrderDto) {
    return this.http.post(`${this.config.get('PAYMENTS_URL')}/pay`, { id: order.id });
  }

  /**
   * An address that names a third party outright. P03 already gave it an
   * `external_api:api.stripe.com` node and a `calls` edge, so the linker counts
   * it in `httpOut.external` and stitches nothing. Not unresolved: an outside
   * address is an answer, not a gap (§10, row 11).
   */
  charge(order: OrderDto): Promise<unknown> {
    return axios.post('https://api.stripe.com/v1/charges', {
      amount: order.total.amount,
      currency: order.total.currency,
    });
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
