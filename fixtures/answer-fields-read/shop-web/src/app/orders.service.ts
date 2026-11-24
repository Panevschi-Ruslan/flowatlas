import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/** The web's own idea of a row: it expects a `discount` the API never sends. */
export interface OrderSummary {
  id: string;
  total: number;
  status: string;
  discount?: number;
}

export interface OrderDetail {
  id: string;
  lines: Array<{ sku: string; qty: number }>;
  customer: { name: string; email: string };
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<OrderSummary[]> {
    return this.http.get<OrderSummary[]>(`${environment.apiUrl}/api/orders`);
  }

  one(id: string): Observable<OrderDetail> {
    return this.http.get<OrderDetail>(`${environment.apiUrl}/api/orders/${id}`);
  }
}
