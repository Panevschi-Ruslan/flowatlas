import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface OrderView {
  id: string;
  status: string;
}

/** The screen's client: two requests to shop-api, one to stock-api. */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  getOrder(orderId: string): Observable<OrderView> {
    return this.http.get<OrderView>(`${environment.apiUrl}/api/orders/${orderId}`);
  }

  cancelOrder(orderId: string, reason: string): Observable<OrderView> {
    return this.http.post<OrderView>(`${environment.apiUrl}/api/orders/${orderId}/cancel`, { reason });
  }

  reservedStock(orderId: string): Observable<number> {
    return this.http.get<number>(`${environment.stockUrl}/orders/${orderId}/reserved`);
  }
}
