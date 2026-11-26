import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { environment } from './environments/environment';

/** The back office's client: one request, the crossing into shop-api. */
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  constructor(private readonly http: HttpClient) {}

  setStatus(orderId: string, status: string): Observable<void> {
    return this.http.patch<void>(`${environment.apiUrl}/api/orders/status`, { orderId, status });
  }
}
