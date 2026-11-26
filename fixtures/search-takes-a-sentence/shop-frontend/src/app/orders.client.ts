import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../environments/environment';

/**
 * Named `cancel`, not `cancelOrder`: asked for `cancelOrder` or "order
 * cancel", no name holds the query as written, and the words find it.
 */
@Injectable({ providedIn: 'root' })
export class OrdersClient {
  constructor(private readonly http: HttpClient) {}

  cancel(orderId: string): Observable<boolean> {
    return this.http.post<boolean>(`${environment.apiUrl}/orders/${orderId}/cancel`, {});
  }

  list(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/orders`);
  }
}
