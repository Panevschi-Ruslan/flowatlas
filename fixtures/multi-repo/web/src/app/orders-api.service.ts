import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { OrderDto } from './order.dto';
import { environment } from '../environments/environment';

/**
 * The six requests this project's browser makes, one per way of ending.
 *
 * `order` is the head of the chain the whole tool exists for: it reaches
 * `entry:gateway:http:GET:/orders/:param`, which reaches `orders`, which reaches
 * `table:orders#Order`.
 */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  /** Rooted at the key `apiTarget` names, and the gateway serves the route. */
  order(id: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(`${environment.apiUrl}/orders/${id}`);
  }

  /** The gateway has no such route: `target-route-not-found`. */
  receipt(id: string): Observable<unknown> {
    return this.http.get<unknown>(`${environment.apiUrl}/orders/${id}/receipt`);
  }

  /**
   * Rooted at a key nothing claims, and both `gateway` and `orders` serve
   * `GET /orders/:param`: `ambiguous-route-target` until a target is configured.
   */
  mirror(id: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(`${environment.ordersUrl}/orders/${id}`);
  }

  /**
   * The hole runs into text rather than sitting between two separators, so the
   * segment could be `42-summary` or `latest-summary` and nothing here says
   * which. Expected: no edge, path `/orders/${…}-summary`, and the request
   * counted under `api-path-partly-read`.
   *
   * It used to assemble `/orders/:param-summary`, which `normalizePath` then
   * collapsed to `/orders/:param`, so it joined to the gateway's real
   * `GET /orders/:param` with the edge marked `static` (R01).
   */
  summary(id: string): Observable<unknown> {
    return this.http.get<unknown>(`${environment.apiUrl}/orders/${id}-summary`);
  }

  /**
   * The address is assembled by a helper, and the argument carries two segments
   * rather than one. Expected: joined to
   * `entry:gateway:http:POST:/orders/:param/invoice`.
   *
   * It used to be read as the settings key and nothing else, so the request was
   * reported against `/`, which the gateway does not serve — a route that was
   * never missing, in a service that never changed (R05).
   */
  invoice(id: string): Observable<unknown> {
    return this.http.post<unknown>(this.urlFor(`${id}/invoice`), {});
  }

  /**
   * The helper takes an optional tail and this caller passes a bare parameter,
   * so whether the tail is empty is decided further out than anything here can
   * read. Writing an argument at all is not asking for the default the guard
   * exists for, so the branch it takes is the answer. Expected: joined to
   * `entry:gateway:http:GET:/orders/:param`, with the edge marked `heuristic`
   * rather than `static`, and `meta.guessed` on the request saying why (R11).
   */
  one(id: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(this.maybeUnder(id));
  }

  private urlFor(path: string): string {
    return `${environment.apiUrl}/orders/${path}`;
  }

  private maybeUnder(path: string = ''): string {
    const base = `${environment.apiUrl}/orders`;
    return path ? `${base}/${path}` : base;
  }
}
