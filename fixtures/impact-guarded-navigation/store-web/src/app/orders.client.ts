import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** The orders client: each of its routes publishes on the shop's orders channel. */
@Injectable({ providedIn: 'root' })
export class OrdersClient {
  constructor(private readonly http: HttpClient) {}

  create(shopId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/api/orders`, {}, { params: { shopId } });
  }

  remove(shopId: string, orderId: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/api/orders/${orderId}`, { params: { shopId } });
  }
}
