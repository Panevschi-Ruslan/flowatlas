import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface Order {
  id: string;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class OrdersApi {
  private readonly base = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  /** Lands on the summary route, declared above `:orderId`. */
  summary(): Observable<unknown> {
    return this.http.get(`${this.base}/orders/summary`);
  }

  /** Lands on `:orderId`, declared above the latest route. */
  latest(): Observable<Order> {
    return this.http.get<Order>(`${this.base}/orders/latest`);
  }

  order(id: string): Observable<Order> {
    return this.http.get<Order>(`${this.base}/orders/${id}`);
  }

  /** Lands on `:orderId`, whose controller is registered first. */
  exportAll(): Observable<string> {
    return this.http.get<string>(`${this.base}/orders/export`);
  }
}
