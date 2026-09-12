import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { OrderDto } from '@fx/contracts';

/**
 * The two calls that address `orders` through its configured base URL.
 *
 * `ORDERS_URL` is what ties them to a repository: `flowatlas.config.json` lists it
 * in `services[orders].baseUrlEnv`, so the linker knows which graph to look for
 * a route in (P05 §10, rows 1 and 4).
 */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Links. `orders` declares `ORDERS_URL` and has `GET /orders/:param`, so this
   * becomes `http_calls` -> `entry:orders:http:GET:/orders/:param`, confidence
   * `static`, `meta.via: "baseUrlEnv"`. The response type is the shared
   * `type:@fx/contracts#OrderDto`, which is the id the edge's `returns` must
   * carry after the merge (D6).
   *
   * `orders` also has a literal `GET /orders/latest`. A client segment that is
   * itself a parameter matches the `:param` route exactly and never the literal
   * one, so this is not ambiguous (§10, rows 6-8).
   */
  fetchOne(id: string): { data: unknown } {
    return this.http.get<OrderDto>(`${this.config.get('ORDERS_URL')}/orders/${id}`);
  }

  /**
   * The drift detector. The service resolves and the route does not: `orders`
   * kept `POST /orders/:param/archive` and never had a `cancel`.
   * Expected: no edge, `http_out.meta.targetService: "orders"`, unresolved
   * `target-route-not-found` whose message reads exactly
   * `target service orders has no route POST /orders/:param/cancel`.
   */
  cancel(id: string): { data: unknown } {
    return this.http.post<OrderDto>(`${this.config.get('ORDERS_URL')}/orders/${id}/cancel`, {
      reason: 'customer',
    });
  }

  /**
   * Two holes in a row. `${id}${suffix}` could be one segment or several, so the
   * address matches nothing and the call is counted as dynamic.
   *
   * It used to assemble `/orders/:param:param`, which `normalizePath` then
   * collapsed to `/orders/:param` because anything after a colon is a parameter
   * name. So it joined to `GET /orders/:param` in `orders` with the edge marked
   * `static`, and the evidence that anything had been guessed was gone (R01).
   */
  variant(id: string, suffix: string): { data: unknown } {
    return this.http.get<OrderDto>(`${this.config.get('ORDERS_URL')}/orders/${id}${suffix}`);
  }
}
