import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { API_ROUTES } from './api-routes';
import type { CreateOrderDto, OrderDto } from './order.dto';
import { environment } from '../environments/environment';
import { API_KEY } from './tokens';

/**
 * Every shape of request the extractor is expected to read.
 *
 * Three addresses it can work out, one it cannot, and one that only the
 * annotation on the method says anything about.
 */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly base = environment.apiUrl;

  constructor(
    private readonly http: HttpClient,
    @Inject(API_KEY) private readonly apiKey: string,
  ) {}

  /** A template rooted at the settings key, with a body type at the call. */
  create(body: CreateOrderDto): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${environment.apiUrl}/orders`, body);
  }

  /** A path kept as a constant somewhere else. */
  list(): Observable<OrderDto[]> {
    return this.http.get<OrderDto[]>(API_ROUTES.orders);
  }

  /** A template with a hole in it, which is a parameter of the route. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/orders/${id}`);
  }

  /** Called from a template through the component that injects this service. */
  refresh(): Observable<OrderDto[]> {
    return this.list();
  }

  /**
   * The address is put together at run time, so there is nothing to read.
   * `@flowatlas-calls` on whoever calls it is the fix, which is what `updateStatus`
   * below does.
   */
  private send(path: string): Observable<unknown> {
    return this.http.get<unknown>(this.base + path);
  }

  /** @flowatlas-calls PATCH /orders/:id/status */
  updateStatus(id: string, status: string): Observable<unknown> {
    return this.send(`/orders/${id}/status?status=${status}`);
  }

  /** @flowatlas-consumes order.updated */
  onOrderUpdated(order: OrderDto): void {
    this.cached = order;
  }

  private cached: OrderDto | null = null;
}
