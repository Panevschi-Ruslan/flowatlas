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

  /**
   * A last segment written as a closed set of two, both of them routes (R31).
   *
   * Read as one `:param` the address is `/orders/:param/:param`, which the
   * gateway serves no route for; read as the two addresses somebody wrote, both
   * join. Expected: `pathChoices` on the node, an edge to each of
   * `POST /orders/:param/ship` and `POST /orders/:param/refund`, and no
   * finding.
   */
  decide(id: string, action: 'ship' | 'refund'): Observable<unknown> {
    return this.http.post<unknown>(`${environment.apiUrl}/orders/${id}/${action}`, {});
  }

  /**
   * The same shape where only one of the two values has a route.
   *
   * Expected: one finding, naming `/orders/:param/hold` as the address that
   * reaches nothing while `/orders/:param/resume` does — which is what a
   * renamed or deleted handler looks like from here.
   */
  advance(id: string, step: 'resume' | 'hold'): Observable<unknown> {
    return this.http.post<unknown>(`${environment.apiUrl}/orders/${id}/${step}`, {});
  }

  /**
   * One unreadable request, and an annotation that can be about nothing else.
   *
   * `@flowatlas-calls` does not repair the request below it — it adds a second
   * one that joins — so the unreadable request keeps its row. With one of each
   * on the method the annotation is unambiguous, and the row is a record of
   * what could not be read rather than work left to do (R39).
   *
   * The annotation names a route only the gateway serves, because one that
   * reached no route would not have answered anything either.
   *
   * Expected: `api-path-dynamic` at `info`, saying there is nothing to do.
   */
  /** @flowatlas-calls POST /orders/:id/invoice */
  probe(): Observable<unknown> {
    return this.http.get<unknown>(this.opaque());
  }

  /**
   * Two unreadable requests, and one annotation.
   *
   * Nothing says which of the two the annotation describes, so both rows stay
   * and say so. Silencing both would hide a real gap behind an annotation that
   * was never about it.
   *
   * Expected: two `api-path-dynamic` rows, both counted, whose hint names the
   * count rather than asking again for the annotation that is already there.
   */
  /** @flowatlas-calls POST /orders/:id/invoice */
  twoBlind(): Observable<unknown> {
    this.http.post<unknown>(this.opaque(), {}).subscribe();
    return this.http.get<unknown>(this.opaque());
  }

  /** An address with nothing readable in it, for the two above. */
  private opaque(): string {
    return globalThis.String(globalThis.Date.now());
  }
}
